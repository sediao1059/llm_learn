import {
  Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ROUTE_NAMES } from '../knowledge/knowledge.service';

/** 提取笔记正文第一句 blockquote 作为大白话摘要（笔记均以「> **一句话**：…」开头） */
function extractSummary(content: string): string {
  const m = content.match(/^>\s*(.+)$/m);
  if (!m) return '';
  return m[1]
    .replace(/\*\*一句话\*\*\s*[:：]\s*/, '')
    .replace(/\*\*/g, '')
    .trim()
    .slice(0, 140);
}

/**
 * 拆出「## N. 高频面试题」章节：入库 content 保留标题行、截掉章节体；
 * 章节体写成 system 面试题注解（前端把标题渲染成可点击入口）。
 */
function splitInterview(content: string): { content: string; interview: { heading: string; body: string } | null } {
  const m = content.match(/^##\s*\d*[.、]?\s*高频面试题\s*$/m);
  if (!m) return { content, interview: null };
  const start = m.index as number;
  const heading = m[0];
  const lineEnd = content.indexOf('\n', start);
  const afterHeading = content.slice(lineEnd + 1);
  const next = afterHeading.match(/^#{1,2}\s/m); // 章节体到下一个同级（h1/h2）标题为止
  const body = afterHeading.slice(0, next ? next.index : afterHeading.length).trim();
  const after = next ? afterHeading.slice(next.index as number) : '';
  const kept = (content.slice(0, start) + heading + '\n\n' + after)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { content: kept, interview: body ? { heading: heading.replace(/^##\s*/, '').trim(), body } : null };
}

/** 数组字段清洗：仅收非空字符串并限量（tags/links/sources 用） */
function strArr(v: any, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s: any) => typeof s === 'string' && s.trim())
    .map((s: string) => s.trim())
    .slice(0, max);
}

/** 把面试题章节体拼回正文标题行下方（编辑详情用；入库 content 只留标题，章节体在 system 注解里） */
function rebuildInterview(content: string, answer: string): string {
  const m = content.match(/^##\s*\d*[.、]?\s*高频面试题\s*$/m);
  if (!m) return content;
  const lineEnd = content.indexOf('\n', m.index as number);
  if (lineEnd === -1) return `${content}\n\n${answer}\n`;
  return content.slice(0, lineEnd + 1) + '\n' + answer + '\n\n' + content.slice(lineEnd + 1).replace(/^\n+/, '');
}

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  /** 编辑详情：把面试题章节体拼回正文，保证再次保存时能重新提取、不丢注解 */
  async detailForEdit(id: string) {
    const note = await this.prisma.note.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('笔记不存在');
    const anno = await this.prisma.annotation.findFirst({
      where: { nodeId: id, type: 'interview', createdBy: 'system' },
    });
    if (anno?.answer) note.content = rebuildInterview(note.content || '', anno.answer);
    return { note };
  }

  /** 校验表单并组装入库数据；返回入库体 + 面试题章节 + 软告警（随响应带回前端提示） */
  private async buildNoteData(body: any, existingId?: string) {
    const warnings: string[] = [];

    const id = existingId ?? String(body.id || '').trim().slice(0, 120);
    if (!existingId && !id) throw new BadRequestException('id 不能为空');
    if (!existingId && !/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new BadRequestException('id 只能包含字母、数字、点、下划线、中划线');
    }

    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) throw new BadRequestException('标题不能为空');

    const category = String(body.category || '').trim().slice(0, 60) || '未分类';
    const layer = String(body.layer || '').trim().slice(0, 40);
    const difficulty = String(body.difficulty || '').trim().slice(0, 10);

    let path = String(body.path || '').trim().slice(0, 10);
    let route = '';
    if (path && !/^\d+\.\d+$/.test(path)) {
      throw new BadRequestException('path 格式应为 路线号.步骤号（如 1.2）');
    }
    if (path) {
      const [prefix, step] = path.split('.');
      route = (ROUTE_NAMES[prefix] || ('路线 ' + prefix)) + ' · 第 ' + Number(step) + ' 步';
    } else {
      path = '';
    }

    const tags = strArr(body.tags, 50);
    const links = strArr(body.links, 100);
    const sources = strArr(body.sources, 50);

    const rawContent = String(body.content || '');
    const split = splitInterview(rawContent);
    const summary = extractSummary(rawContent).slice(0, 500);

    if (!summary) warnings.push('正文缺少「> **一句话**：…」大白话摘要（展示在图谱 tooltip 与笔记面板）');
    if (!layer) warnings.push('未标注 layer（将归入"未分层"，判据见 docs/content-style-guide.md §5）');
    if (!difficulty) warnings.push('未标注 difficulty（入门/进阶/深入，判据见 docs/content-style-guide.md §5）');
    if (links.length) {
      const resolvable = new Set([
        ...(await this.prisma.note.findMany({ where: { id: { in: links } }, select: { id: true } })).map(r => r.id),
        ...(await this.prisma.aiNode.findMany({ where: { id: { in: links } }, select: { id: true } })).map(r => r.id),
      ]);
      const missing = links.filter(l => !resolvable.has(l));
      if (missing.length) warnings.push(`links 指向不存在的知识点：${missing.join('、')}`);
    }

    return {
      data: {
        id, title, category,
        layer: layer || '未分层',
        path, route,
        difficulty: difficulty || '未标注',
        status: body.status === 'todo' ? 'todo' : 'learned',
        tags: JSON.stringify(tags),
        links: JSON.stringify(links),
        sources: JSON.stringify(sources),
        updatedAt: new Date().toISOString().slice(0, 10),
        summary,
        content: split.content,
      },
      interview: split.interview,
      warnings,
    };
  }

  async create(body: any) {
    const { data, interview, warnings } = await this.buildNoteData(body);
    if (await this.prisma.note.findUnique({ where: { id: data.id } })) {
      throw new ConflictException(`id "${data.id}" 已存在`);
    }
    if (await this.prisma.aiNode.findUnique({ where: { id: data.id } })) {
      warnings.push(`id 与 AI 沉淀节点 "${data.id}" 相同，图谱上会互相覆盖，建议更换`);
    }
    await this.prisma.note.create({ data: { ...data, syncedAt: new Date() } });
    await this.syncInterviewAnnotation(data.id, interview);
    return { note: data, warnings };
  }

  async update(id: string, body: any) {
    if (!await this.prisma.note.findUnique({ where: { id } })) {
      throw new NotFoundException('笔记不存在');
    }
    if (body.id !== undefined && String(body.id).trim() !== id) {
      throw new BadRequestException('id 不可修改（其他数据按 id 关联）');
    }
    const { data, interview, warnings } = await this.buildNoteData(body, id);
    await this.prisma.note.update({ where: { id }, data: { ...data, syncedAt: new Date() } });
    await this.syncInterviewAnnotation(id, interview);
    return { note: data, warnings };
  }

  async remove(id: string) {
    if (!await this.prisma.note.findUnique({ where: { id } })) {
      throw new NotFoundException('笔记不存在');
    }
    // notes 表无外键：引用方按 nodeId 一并清理（含注解的回复、面试题 system 注解），
    // 学习路线树内嵌的 refId 不清理（前端对悬空 id 静默跳过，与历史行为一致）
    const annoIds = (await this.prisma.annotation.findMany({
      where: { nodeId: id }, select: { id: true },
    })).map(a => a.id);
    await this.prisma.annotationReply.deleteMany({ where: { annotationId: { in: annoIds } } });
    await this.prisma.$transaction([
      this.prisma.annotation.deleteMany({ where: { nodeId: id } }),
      this.prisma.progress.deleteMany({ where: { nodeId: id } }),
      this.prisma.favorite.deleteMany({ where: { nodeId: id } }),
      this.prisma.viewHistory.deleteMany({ where: { nodeId: id } }),
      this.prisma.nodeNote.deleteMany({ where: { nodeId: id } }),
      this.prisma.nodeTier.deleteMany({ where: { nodeId: id } }),
      this.prisma.graphExpansion.deleteMany({ where: { nodeId: id } }),
      this.prisma.aiReview.deleteMany({ where: { nodeId: id } }),
      this.prisma.aiMerge.deleteMany({ where: { targetNodeId: id } }),
      this.prisma.note.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  /** 面试题 system 注解幂等同步：章节有则更新、无则删除 */
  private async syncInterviewAnnotation(nodeId: string, interview: { heading: string; body: string } | null) {
    const existing = await this.prisma.annotation.findFirst({
      where: { nodeId, type: 'interview', createdBy: 'system' },
    });
    if (!interview) {
      if (existing) await this.prisma.annotation.delete({ where: { id: existing.id } });
      return;
    }
    if (existing) {
      await this.prisma.annotation.update({
        where: { id: existing.id },
        data: { anchorText: interview.heading, answer: interview.body, createdAt: new Date() },
      });
    } else {
      await this.prisma.annotation.create({
        data: {
          nodeId, anchorText: interview.heading, anchorContext: '', anchorIndex: 0,
          type: 'interview', question: '高频面试题（笔记原文提取）', answer: interview.body,
          status: 'approved', createdBy: 'system',
        },
      });
    }
  }
}
