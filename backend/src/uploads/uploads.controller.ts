import {
  Controller, Get, Post, Body, Param, Query, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LlmBanGuard } from '../auth/guards/llm-ban.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { LlmService } from '../llm/llm.service';

@Controller()
@UseGuards(JwtAuthGuard, LlmBanGuard)
export class UploadsController {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
  ) {}

  private excerpt(s: string, n = 160) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  }

  private pub(u: any, items: any[], withContent = false) {
    return {
      id: u.id, kind: u.kind, url: u.sourceUrl, title: u.title, note: u.note,
      status: u.status, errorMsg: u.errorMsg, rejectReason: u.rejectReason,
      submittedBy: u.submittedBy, createdAt: u.createdAt,
      decidedAt: u.decidedAt, decidedBy: u.decidedBy,
      profileTags: (()=>{try{return JSON.parse(u.profileTags||'{}')}catch{return{level:'novice',focus:[]}}})(),
      collectionSuggestion: u.status === 'extracted' ? {
        mode: u.collectionMode, title: u.collectionTitle, summary: u.collectionSummary, mergeId: u.collectionMergeId,
      } : null,
      rawExcerpt: withContent ? this.excerpt(u.rawText || u.sourceUrl) : '',
      items: (items || []).map((it: any) => ({
        id: it.id, seq: it.seq, title: it.title,
        tags: (()=>{try{return JSON.parse(it.tags||'[]')}catch{return[]}})(),
        links: (()=>{try{return JSON.parse(it.links||'[]')}catch{return[]}})(),
        content: withContent ? it.content : '',
      })),
    };
  }

  @Post('ai/uploads')
  async create(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const kind = body.kind === 'url' ? 'url' : 'text';
    let sourceUrl = '', rawText = '', title = '';
    if (kind === 'url') {
      sourceUrl = String(body.url || '').trim().slice(0, 600);
      if (!/^https?:\/\//.test(sourceUrl)) throw new BadRequestException('链接需以 http(s):// 开头');
    } else {
      rawText = String(body.text || '').trim().slice(0, 200000);
      title = String(body.title || '').trim().slice(0, 200);
      if (rawText.length < 200) throw new BadRequestException('文本太短（至少 200 字）');
      if (!title) throw new BadRequestException('请给这段文本起个标题');
    }
    const r = await this.prisma.upload.create({
      data: {
        kind, sourceUrl, rawText, title,
        note: String(body.note || '').trim().slice(0, 500),
        submittedBy: user.username,
        profileTags: JSON.stringify(user.profileTags),
        status: 'extracting',
      },
    });
    // 后台拆解（不阻塞请求）
    this.runExtraction(r.id).catch(() => {});
    return { upload: { id: r.id, status: 'extracting' } };
  }

  @Get('ai/uploads/mine')
  async mine(@CurrentUser() user: CurrentUserType) {
    const uploads = await this.prisma.upload.findMany({
      where: { submittedBy: user.username },
      orderBy: { id: 'desc' }, take: 50,
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    return { uploads: uploads.map(u => this.pub(u, u.items, false)) };
  }

  /** 后台拆解（抓取+LLM→写 items→extracted） */
  private async runExtraction(uploadId: number) {
    try {
      const up = await this.prisma.upload.findUnique({ where: { id: uploadId } });
      if (!up) return;
      let sourceText = up.rawText || '';
      if (up.kind === 'url') {
        // 简化抓取（生产建议走队列）
        const resp = await fetch(up.sourceUrl, {
          headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(20_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        sourceText = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60000);
        if (sourceText.length < 500) throw new Error(`正文过短（${sourceText.length} 字）`);
      }
      const model = await this.llm.getGlobalModel();
      if (!model) throw new Error('尚未配置全局默认模型');
      const bundleNodes = await this.prisma.note.findMany({ select: { id: true, title: true, category: true } });
      const cols = await this.prisma.aiNode.findMany({ where: { id: { startsWith: 'col-' } }, select: { id: true, title: true } });
      const system = up.kind === 'url'
        ? `你是知识采集引擎。把网页文章拆解成 1~5 个知识点（markdown 笔记+检索标签+关联已有 id+专栏建议）。
- 每个知识点的 markdown 第一行必须是「> **一句话**：…」大白话摘要：外行能听懂，能打比方就打比方
- 正文直白表述：术语第一次出现紧跟括号翻译，先说结论再展开，不写空话套话
严格输出 JSON：{"collection":{"mode":"new 或 merge","title":"","summary":"","mergeId":""},"items":[{"title":"","content":"","tags":[],"links":[]}]`
        : `你是知识整理引擎。把用户文本格式化成 1~5 个知识点（不添加原文没有的内容）。
- 每个知识点的 markdown 第一行必须是「> **一句话**：…」大白话摘要；术语第一次出现紧跟括号翻译，直白表述不写空话
严格输出 JSON：{"collection":{"mode":"new","title":"","summary":"","mergeId":""},"items":[{"title":"","content":"","tags":[],"links":[]}]}`;
      const r = await this.llm.chatText(model, {
        system,
        user: `已有知识点：\n${bundleNodes.map(n=>`- ${n.id}｜${n.title}`).join('\n')}\n\n已有专栏：\n${cols.map(c=>`${c.id}《${c.title}》`).join('、')||'（暂无）'}\n\n【正文】\n${sourceText}`,
        timeoutMs: 300_000,
      });
      if (!r.ok) throw new Error(r.error);
      const start = r.text.indexOf('{'); const end = r.text.lastIndexOf('}');
      const raw = JSON.parse(r.text.slice(start, end + 1));
      if (!raw.items?.length) throw new Error('拆解结果没有有效知识点');

      await this.prisma.uploadItem.deleteMany({ where: { uploadId } });
      const knownIds = new Set(bundleNodes.map(n => n.id));
      for (let i = 0; i < Math.min(raw.items.length, 5); i++) {
        const it = raw.items[i];
        if (!it.title || !it.content) continue;
        await this.prisma.uploadItem.create({
          data: {
            uploadId, seq: i,
            title: String(it.title).slice(0, 120),
            content: String(it.content).slice(0, 30000),
            tags: JSON.stringify((it.tags || []).slice(0, 6)),
            links: JSON.stringify((it.links || []).filter((l: string) => knownIds.has(l)).slice(0, 5)),
          },
        });
      }
      const col = raw.collection || {};
      await this.prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: 'extracted', errorMsg: null,
          collectionMode: col.mode === 'merge' && knownIds.has(col.mergeId) ? 'merge' : 'new',
          collectionTitle: col.title || up.title || '',
          collectionSummary: col.summary || '',
          collectionMergeId: col.mergeId || null,
        },
      });
    } catch (e: any) {
      await this.prisma.upload.update({
        where: { id: uploadId },
        data: { status: 'extract_failed', errorMsg: String(e?.message || e).slice(0, 500) },
      }).catch(() => {});
    }
  }

  // ===== 管理端 =====
  @Get('admin/uploads')
  @Roles('admin')
  async adminList(@Query('status') status: string) {
    const s = ['extracting', 'extracted', 'extract_failed', 'approved', 'rejected'].includes(status) ? status : 'extracted';
    const uploads = await this.prisma.upload.findMany({
      where: { status: s }, orderBy: { id: 'desc' }, take: 50,
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    const cols = await this.prisma.aiNode.findMany({
      where: { id: { startsWith: 'col-' } }, orderBy: { id: 'desc' }, select: { id: true, title: true },
    });
    return { uploads: uploads.map(u => this.pub(u, u.items, true)), collections: cols };
  }

  @Post('admin/uploads/:id/approve')
  @Roles('admin')
  async approve(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const up = await this.prisma.upload.findUnique({
      where: { id }, include: { items: { orderBy: { seq: 'asc' } } },
    });
    if (!up) throw new NotFoundException('上传不存在');
    if (up.status !== 'extracted') throw new BadRequestException('该上传不在待审核状态');

    const deleted = new Set((body.deletedIds || []).map(Number));
    const edits = new Map<number, any>((body.items || []).map((x: any) => [Number(x.id), x] as [number, any]));
    const kept = up.items.filter(it => !deleted.has(it.id));
    if (!kept.length) throw new BadRequestException('请至少保留一个知识点');

    const sug = body.collection || { mode: up.collectionMode, title: up.collectionTitle, summary: up.collectionSummary, mergeId: up.collectionMergeId };
    const staticIds = new Set((await this.prisma.aiNode.findMany({ select: { id: true } })).map(n => n.id));
    const noteIds = new Set((await this.prisma.note.findMany({ select: { id: true } })).map(n => n.id));
    const knownIds = new Set([...staticIds, ...noteIds]);

    let colId: string;
    if (sug.mode === 'merge' && sug.mergeId && staticIds.has(String(sug.mergeId))) {
      colId = String(sug.mergeId);
    } else if (sug.mode === 'merge') {
      throw new BadRequestException('要并入的专栏不存在');
    } else {
      colId = 'col-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const tags = [...new Set(kept.flatMap(it => {
        const e = edits.get(it.id);
        return e?.tags || JSON.parse(it.tags || '[]');
      }))].slice(0, 10);
      const links = [...new Set(kept.flatMap(it => {
        const e = edits.get(it.id);
        return (e?.links || JSON.parse(it.links || '[]')).filter((l: string) => knownIds.has(l));
      }))].slice(0, 10);
      await this.prisma.aiNode.create({
        data: {
          id: colId, title: sug.title || up.title || '未命名专栏',
          category: '📚 专栏', layer: '未分层',
          tags: JSON.stringify(tags),
          content: sug.summary || `专栏，收录 ${kept.length} 篇`,
          links: JSON.stringify(links),
          createdBy: up.submittedBy, profileTags: up.profileTags,
        },
      });
    }

    for (const it of kept) {
      const e = edits.get(it.id) || {};
      const title = String(e.title || it.title).slice(0, 200);
      const tags = e.tags || JSON.parse(it.tags || '[]');
      const links = (e.links || JSON.parse(it.links || '[]')).filter((l: string) => knownIds.has(l));
      await this.prisma.collectionItem.create({
        data: {
          collectionNodeId: colId, title, content: it.content,
          tags: JSON.stringify(tags), links: JSON.stringify(links),
          sourceUploadId: up.id, createdBy: up.submittedBy, profileTags: up.profileTags,
        },
      });
      await this.prisma.activity.create({
        data: { userName: up.submittedBy, kind: 'uploadItem', points: 8, note: `上传入库《${title}》` },
      });
    }
    await this.prisma.upload.update({
      where: { id },
      data: { status: 'approved', decidedAt: new Date(), decidedBy: user.username },
    });
    return { ok: true, collectionId: colId, itemCount: kept.length, points: kept.length * 8 };
  }

  @Post('admin/uploads/:id/reject')
  @Roles('admin')
  async reject(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const up = await this.prisma.upload.findUnique({ where: { id } });
    if (!up) throw new NotFoundException('上传不存在');
    if (up.status !== 'extracted' && up.status !== 'extract_failed') throw new BadRequestException('不可驳回');
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) throw new BadRequestException('请填写驳回理由');
    await this.prisma.upload.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: user.username, rejectReason: reason },
    });
    return { ok: true };
  }

  @Post('admin/uploads/:id/retry')
  @Roles('admin')
  async retry(@Param('id') id: number) {
    const up = await this.prisma.upload.findUnique({ where: { id } });
    if (!up) throw new NotFoundException('上传不存在');
    if (up.status !== 'extract_failed') throw new BadRequestException('只有拆解失败的可以重试');
    await this.prisma.upload.update({ where: { id }, data: { status: 'extracting', errorMsg: null } });
    this.runExtraction(id).catch(() => {});
    return { ok: true, started: true };
  }
}
