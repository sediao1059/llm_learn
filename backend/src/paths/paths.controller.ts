import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards,
  BadRequestException, NotFoundException, ForbiddenException, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LlmBanGuard } from '../auth/guards/llm-ban.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { LlmService } from '../llm/llm.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

const PATH_SYSTEM = `你是「LLM 学习知识图谱」的学习路线规划师。基于图谱里已有的知识点清单和用户的学习目标，规划一条阶段清晰、可执行的学习路线。
- 路线是多层树：阶段 → 主题 → 子主题（最多三层）
- 每个主题尽量复用清单里已有的知识点（填 refId）
- 阶段 3~6 个，每阶段 3~8 个主题；每个主题的 why 用一句大白话说清「学它干嘛、解决什么问题」，不写空话
严格输出 JSON：{"title":"","summary":"","stages":[{"title":"","goal":"","items":[{"title":"","refId":"","why":"","children":[]}]}]}`;

@Controller()
@UseGuards(JwtAuthGuard, LlmBanGuard)
export class PathsController {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private knowledge: KnowledgeService,
  ) {}

  @Post('ai/paths/generate')
  async generate(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const goal = String(body.goal || '').trim().slice(0, 300);
    const feedback = String(body.feedback || '').trim().slice(0, 500);
    if (!goal && !feedback) throw new BadRequestException('请填写学习目标或调整要求');
    const model = await this.llm.getGlobalModel();
    if (!model) throw new BadRequestException('尚未配置全局默认模型');

    const bundle = await this.knowledge.getBundleObj();
    const aiNodes = await this.prisma.aiNode.findMany();
    const knownIds = new Set([...bundle.nodes.map((n: any) => n.id), ...aiNodes.map(n => n.id)]);
    const lines = bundle.nodes.map((n: any) => `- ${n.id}｜${n.title}｜${n.category}｜${n.tags.join('/')}`);

    const lv = user.profileTags?.level === 'expert' ? '老手（跳过入门直击进阶）' : '新手（从打地基开始）';
    const focus = (user.profileTags?.focus || []).join('、') || '未指定';
    let prompt = `【用户画像】大模型${lv}；关注方向：${focus}\n\n已有知识点清单：\n${lines.join('\n')}\n\n`;
    if (body.pathId) {
      const existing = await this.prisma.learningPath.findUnique({ where: { id: Number(body.pathId) } });
      if (!existing) throw new NotFoundException('要调整的路线不存在');
      prompt += `【已有路线 JSON】\n${existing.tree}\n\n【用户调整要求】\n${feedback || goal}`;
    } else {
      prompt += `【用户学习目标】\n${goal}`;
    }

    const r = await this.llm.chatText(model, { system: PATH_SYSTEM, user: prompt, timeoutMs: 240 * 1000 });
    if (!r.ok) throw new BadRequestException('生成失败：' + r.error);
    try {
      const start = r.text.indexOf('{'); const end = r.text.lastIndexOf('}');
      const raw = JSON.parse(r.text.slice(start, end + 1));
      // 清洗 refId
      const clean = (items: any[]): any[] => (items || []).map((it: any) => ({
        title: String(it.title || '').slice(0, 60),
        refId: knownIds.has(it.refId) ? it.refId : '',
        why: String(it.why || '').slice(0, 120),
        children: it.children ? clean(it.children) : [],
      }));
      const stages = (raw.stages || []).slice(0, 8).map((st: any) => ({
        title: String(st.title || '').slice(0, 40),
        goal: String(st.goal || '').slice(0, 120),
        items: clean(st.items).slice(0, 12),
      }));
      if (!stages.length) throw new Error('路线没有阶段');
      return { tree: { title: String(raw.title || '').slice(0, 60), summary: String(raw.summary || '').slice(0, 300), stages } };
    } catch (e: any) {
      throw new BadRequestException('路线内容无效：' + e.message);
    }
  }

  @Get('ai/paths')
  async list(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.learningPath.findMany({
      orderBy: [{ isOfficial: 'desc' }, { id: 'desc' }], take: 100,
    });
    return {
      paths: rows.map(r => {
        let t: any = null;
        try { t = JSON.parse(r.tree); } catch {}
        return {
          id: r.id, title: r.title, goal: r.goal, tree: t,
          summary: t?.summary || '', stageCount: t?.stages?.length || 0,
          isOfficial: !!r.isOfficial, createdBy: r.createdBy, createdAt: r.createdAt,
        };
      }),
    };
  }

  @Post('ai/paths')
  async save(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const title = String(body.title || '').trim().slice(0, 60) || '我的学习路线';
    const tree = body.tree;
    if (!tree || !Array.isArray(tree.stages) || !tree.stages.length) throw new BadRequestException('路线内容为空或格式不正确');
    const r = await this.prisma.learningPath.create({
      data: { title, goal: String(body.goal || '').slice(0, 300), tree: JSON.stringify(tree), createdBy: user.username },
    });
    return { path: { id: r.id, title } };
  }

  /** AI 智能扩展路线：将一个新知识点插入路线树最合适的位置 */
  @Post('ai/paths/:id/extend')
  async extend(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.learningPath.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('路线不存在');
    if (row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能扩展自己创建的路线');
    }
    const nodeId = String(body.nodeId || '').trim();
    if (!nodeId) throw new BadRequestException('缺少 nodeId');

    const model = await this.llm.getGlobalModel();
    if (!model) throw new BadRequestException('尚未配置全局默认模型');

    // 获取知识点信息
    const note = await this.prisma.note.findUnique({ where: { id: nodeId } });
    const aiNode = note ? null : await this.prisma.aiNode.findUnique({ where: { id: nodeId } });
    const node = note || aiNode;
    if (!node) throw new BadRequestException('知识点不存在');

    // 已在路线中则不重复添加
    if (row.tree.includes(`"refId":"${nodeId}"`)) {
      throw new BadRequestException('该知识点已在路线中');
    }

    const system = `你是学习路线编辑助手。用户想把一个新知识点插入到已有学习路线的最合适位置。
- 只在合适的阶段插入这个知识点（标题 + refId + 一句大白话 why），不改动其他内容
- 如果需要可以在现有阶段中插入，也可以新建一个阶段（仅在确实需要时）
- 输出更新后的完整路线 JSON（格式与输入完全相同）
严格输出 JSON：{"title":"","summary":"","stages":[{"title":"","goal":"","items":[{"title":"","refId":"","why":""}]}]}`;

    const userPrompt = `【当前路线 JSON】
${row.tree}

【要插入的知识点】
id: ${nodeId}
标题: ${node.title}
分类: ${node.category}
层次: ${node.layer || '未分层'}
标签: ${note ? JSON.parse(note.tags || '[]').join(', ') : ''}
摘要: ${(note?.summary || aiNode?.content || '').slice(0, 200)}

请将这个知识点插入路线中最合适的位置，输出更新后的完整 JSON。`;

    const r = await this.llm.chatText(model, { system, user: userPrompt, timeoutMs: 180_000 });
    if (!r.ok) throw new BadRequestException('AI 整合失败：' + r.error);

    // 解析并校验
    try {
      const start = r.text.indexOf('{');
      const end = r.text.lastIndexOf('}');
      const raw = JSON.parse(r.text.slice(start, end + 1));
      // 基本校验
      if (!raw.stages?.length) throw new Error('没有阶段');
      // 确保新 nodeId 已加入
      const treeStr = JSON.stringify(raw);
      if (!treeStr.includes(`"refId":"${nodeId}"`)) throw new Error('新知识点未加入');
      // 确保原有 refId 没有丢失
      const oldRefIds = (row.tree.match(/"refId":"([^"]+)"/g) || []).map(m => m.replace(/"refId":"|"/g, ''));
      const lostIds = oldRefIds.filter(oid => !treeStr.includes(`"refId":"${oid}"`));
      if (lostIds.length) throw new Error(`丢失了 ${lostIds.length} 个已有知识点`);

      const tree = JSON.stringify(raw);
      await this.prisma.learningPath.update({ where: { id }, data: { tree } });
      return { tree: raw };
    } catch (e: any) {
      throw new BadRequestException('路线更新校验失败：' + e.message + '，请重试');
    }
  }

  /** 在路线树 JSON 中按「阶段下标 + 主题下标链」定位条目（原地引用，用于回填 content） */
  private locateItem(tree: any, stageIdx: number, itemPath: number[]): any | null {
    const stage = tree?.stages?.[stageIdx];
    let item: any = stage?.items?.[itemPath[0]];
    for (let i = 1; i < itemPath.length && item; i++) item = item.children?.[itemPath[i]];
    return item || null;
  }

  /**
   * 新主题懒加载生成（SSE 流式）：点击路线上未关联知识点的「新主题」时，
   * 按路线上下文流式生成一篇 markdown 学习内容；生成完写入路线树 JSON 缓存（item.content），
   * 下次点击直接命中缓存不再调模型。force=true 可重新生成覆盖。
   */
  @Post('ai/paths/:id/topic-content')
  async topicContent(
    @Param('id') id: number,
    @Body() body: any,
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ) {
    const row = await this.prisma.learningPath.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('路线不存在');
    const stageIdx = Number(body.stageIdx);
    const itemPath: number[] = Array.isArray(body.itemPath) ? body.itemPath.map(Number) : [];
    if (!Number.isInteger(stageIdx) || stageIdx < 0 || !itemPath.length || itemPath.some(i => !Number.isInteger(i) || i < 0)) {
      throw new BadRequestException('主题定位不正确');
    }

    let tree: any;
    try { tree = JSON.parse(row.tree); } catch { throw new BadRequestException('路线数据损坏'); }
    const stage = tree.stages?.[stageIdx];
    const item = this.locateItem(tree, stageIdx, itemPath);
    if (!stage || !item) throw new BadRequestException('主题不存在');
    if (item.refId) throw new BadRequestException('该主题已关联知识点，请直接点击打开');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: any) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 断开 */ }
    };
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 10000);
    const done = () => { clearInterval(heartbeat); res.end(); };

    // 缓存命中：不调模型，直接整篇返回
    if (item.content && !body.force) {
      send('result', { content: item.content, cached: true });
      done();
      return;
    }

    const model = await this.llm.getGlobalModel();
    if (!model) { send('error', { error: '尚未配置全局默认模型' }); done(); return; }

    const bundle = await this.knowledge.getBundleObj();
    const lines = bundle.nodes.slice(0, 200).map((n: any) => `- ${n.title}（${n.category}）`);

    const lv = user.profileTags?.level === 'expert' ? '老手（直接讲进阶细节与工程取舍）' : '新手（从打地基开始，术语第一次出现要翻译）';
    const focus = (user.profileTags?.focus || []).join('、') || '未指定';
    const system = `你是「LLM 学习知识图谱」的知识讲解作者，为学习路线中的一个主题写一篇可直接阅读的学习笔记。写作第一原则：**直白**——把稿子念给刚入行的人听，能一次听懂才算合格。
- 第一行必须是「> **一句话**：…」摘要：用大白话+比喻说清这个主题是干什么的（例如「KV Cache 就是模型做题时的草稿纸」），不许出现没解释的缩写和黑话
- 每个小节的第一句话先用大白话点明这节讲什么、结论是什么，再展开细节；先讲「就像…」「比如…」，不要一上来堆术语
- 术语第一次出现必须紧跟括号翻译，如「PagedAttention（把缓存像操作系统内存一样分页管理）」，之后可直接用
- 具体例子、表格优先于抽象长段落；公式出现前先用文字说清它在算什么、为什么要算
- 不写空话套话（「赋能」「闭环」「范式」之类），不用名词堆砌充数
- 输出标准 markdown：小节用 ##、子节用 ###；适当使用列表、表格、代码块
- 内容 800~2000 字，自成一体：这个主题是什么 → 为什么需要它 → 核心原理 → 上手示例 → 常见坑
- 与已有知识点清单相关的内容可以自然提一句（用知识点标题），但不要罗列清单
- 严格按用户画像调整深浅（新手多比喻多翻译；老手可直给参数与工程取舍，但结论仍要先说人话），不要输出与主题无关的寒暄`;

    const userPrompt = `【用户画像】大模型${lv}；关注方向：${focus}
【所属路线】${row.title}（目标：${row.goal || '未填写'}）
【所属阶段】${stage.title}${stage.goal ? `（${stage.goal}）` : ''}
【主题】${item.title}
${item.why ? `【路线里给这个主题的定位】${item.why}\n` : ''}已有知识点清单（供关联参考）：
${lines.join('\n')}

请为主题「${item.title}」写这篇学习笔记。`;

    try {
      const r = await this.llm.chatStream(model, {
        system,
        messages: [{ role: 'user', content: userPrompt }],
        onDelta: t => send('delta', { text: t }),
        timeoutMs: 240 * 1000,
      });
      if (!r.ok) {
        send('error', { error: r.error || '生成失败' });
      } else {
        // 回填缓存：重新读最新树再写入，尽量不覆盖他人并发改动；只填 content 不动其他字段
        const latest = await this.prisma.learningPath.findUnique({ where: { id } });
        if (latest) {
          try {
            const t2 = JSON.parse(latest.tree);
            const it = this.locateItem(t2, stageIdx, itemPath);
            if (it && !it.refId && (body.force || !it.content)) {
              it.content = r.text;
              await this.prisma.learningPath.update({ where: { id }, data: { tree: JSON.stringify(t2) } });
            }
          } catch { /* 缓存写失败不影响返回 */ }
        }
        // 记录 LLM 用量（token 按文本长度/4 粗估）
        this.prisma.llmUsage.create({
          data: {
            userId: user.id, username: user.username,
            modelName: model.name || model.modelId,
            promptTokens: Math.ceil((system.length + userPrompt.length) / 4),
            outputTokens: Math.ceil(r.text.length / 4),
          },
        }).catch(() => {});
        send('result', { content: r.text, cached: false });
      }
    } catch (e: any) {
      send('error', { error: String(e?.message || e) });
    } finally {
      done();
    }
  }

  @Patch('ai/paths/:id')
  async updateTitle(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.learningPath.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('路线不存在');
    if (row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能修改自己创建的路线');
    }
    const title = String(body.title || '').trim().slice(0, 60);
    if (!title) throw new BadRequestException('标题不能为空');
    await this.prisma.learningPath.update({ where: { id }, data: { title } });
    return { ok: true, title };
  }

  @Delete('ai/paths/:id')
  async remove(@Param('id') id: number, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.learningPath.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('路线不存在');
    if (row.isOfficial && user.role !== 'admin') throw new ForbiddenException('官方路线只有管理员能删除');
    if (!row.isOfficial && row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能删除自己创建的路线');
    }
    await this.prisma.learningPath.delete({ where: { id } });
    return { ok: true };
  }

  // ===== 管理端 =====
  @Get('admin/paths')
  @Roles('admin')
  async adminList() {
    const rows = await this.prisma.learningPath.findMany({
      orderBy: [{ isOfficial: 'desc' }, { id: 'desc' }], take: 200,
    });
    return {
      paths: rows.map(r => ({
        id: r.id, title: r.title, isOfficial: !!r.isOfficial,
        createdBy: r.createdBy, createdAt: r.createdAt,
      })),
    };
  }

  @Post('admin/paths/:id/official')
  @Roles('admin')
  async setOfficial(@Param('id') id: number, @Body() body: any) {
    const official = body.official === false ? 0 : 1;
    await this.prisma.learningPath.update({ where: { id }, data: { isOfficial: official } });
    return { ok: true };
  }
}
