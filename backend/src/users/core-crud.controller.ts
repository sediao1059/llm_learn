import {
  Controller, Get, Post, Put, Delete, Body, Query, UseGuards, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';

/** 简单 CRUD：学习进度 / 收藏 / 个人笔记 / 浏览足迹 / 贡献值 */
@Controller()
@UseGuards(JwtAuthGuard)
export class CoreCrudController {
  constructor(private prisma: PrismaService) {}

  // ===== 学习进度 =====
  @Get('progress')
  async getProgress(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.progress.findMany({ where: { userId: user.id } });
    const progress: Record<string, { level: number; updatedAt: string }> = {};
    for (const r of rows) progress[r.nodeId] = { level: r.level, updatedAt: r.updatedAt.toISOString() };
    return { progress };
  }

  @Put('progress')
  async setProgress(@CurrentUser() user: CurrentUserType, @Body() body: any) {
    const nodeId = String(body.nodeId || '');
    const level = Number(body.level);
    if (!nodeId || nodeId.length > 100) throw new BadRequestException('nodeId 不合法');
    if (!Number.isInteger(level) || level < 0 || level > 3) throw new BadRequestException('level 需为 0–3');
    await this.prisma.progress.upsert({
      where: { userId_nodeId: { userId: user.id, nodeId } },
      create: { userId: user.id, nodeId, level },
      update: { level },
    });
    return { ok: true };
  }

  // ===== 收藏 =====
  /** 节点标题映射：静态笔记 + AI 沉淀节点（足迹/收藏弹窗展示用） */
  private async nodeTitleMap() {
    const [notes, aiNodes] = await Promise.all([
      this.prisma.note.findMany({ select: { id: true, title: true, category: true } }),
      this.prisma.aiNode.findMany({ select: { id: true, title: true } }),
    ]);
    const map = new Map<string, { title: string; category: string }>();
    notes.forEach(n => map.set(n.id, { title: n.title, category: n.category }));
    aiNodes.forEach(n => map.set(n.id, { title: n.title, category: 'AI 沉淀' }));
    return map;
  }

  @Get('favorites')
  async getFavorites(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId: user.id }, orderBy: { createdAt: 'desc' },
    });
    const titles = await this.nodeTitleMap();
    return {
      favorites: rows.map(r => ({
        nodeId: r.nodeId, createdAt: r.createdAt,
        title: titles.get(r.nodeId)?.title || r.nodeId,
        category: titles.get(r.nodeId)?.category || '',
      })),
    };
  }

  @Put('favorites')
  async toggleFavorite(@CurrentUser() user: CurrentUserType, @Body() body: any) {
    const nodeId = String(body.nodeId || '');
    if (!nodeId || nodeId.length > 100) throw new BadRequestException('nodeId 不合法');
    if (body.on) {
      await this.prisma.favorite.upsert({
        where: { userId_nodeId: { userId: user.id, nodeId } },
        create: { userId: user.id, nodeId },
        update: {},
      });
    } else {
      await this.prisma.favorite.deleteMany({ where: { userId: user.id, nodeId } });
    }
    return { ok: true };
  }

  // ===== 个人笔记 =====
  @Get('notes')
  async getNote(@CurrentUser() user: CurrentUserType, @Query('nodeId') nodeId: string) {
    if (!nodeId) throw new BadRequestException('缺少 nodeId');
    const row = await this.prisma.nodeNote.findUnique({
      where: { userId_nodeId: { userId: user.id, nodeId } },
    });
    return { note: row?.content || '' };
  }

  @Put('notes')
  async setNote(@CurrentUser() user: CurrentUserType, @Body() body: any) {
    const nodeId = String(body.nodeId || '');
    const content = String(body.content || '').slice(0, 10000);
    if (!nodeId || nodeId.length > 100) throw new BadRequestException('nodeId 不合法');
    await this.prisma.nodeNote.upsert({
      where: { userId_nodeId: { userId: user.id, nodeId } },
      create: { userId: user.id, nodeId, content },
      update: { content },
    });
    return { ok: true };
  }

  // ===== 浏览足迹 =====
  @Post('history')
  async recordHistory(@CurrentUser() user: CurrentUserType, @Body() body: any) {
    const nodeId = String(body.nodeId || '');
    if (!nodeId || nodeId.length > 100) throw new BadRequestException('nodeId 不合法');
    // upsert: increment count if exists, create if not
    const existing = await this.prisma.viewHistory.findUnique({
      where: { userId_nodeId: { userId: user.id, nodeId } },
    });
    if (existing) {
      await this.prisma.viewHistory.update({
        where: { id: existing.id },
        data: { count: { increment: 1 }, lastViewedAt: new Date() },
      });
    } else {
      await this.prisma.viewHistory.create({ data: { userId: user.id, nodeId } });
    }
    // 只保留最近 200 条
    const all = await this.prisma.viewHistory.findMany({
      where: { userId: user.id },
      orderBy: [{ lastViewedAt: 'desc' }, { id: 'desc' }],
      take: 200, select: { id: true },
    });
    const keepIds = all.map(r => r.id);
    await this.prisma.viewHistory.deleteMany({
      where: { userId: user.id, id: { notIn: keepIds } },
    });
    return { ok: true };
  }

  @Get('history')
  async getHistory(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.viewHistory.findMany({
      where: { userId: user.id },
      orderBy: [{ lastViewedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    const titles = await this.nodeTitleMap();
    return {
      history: rows.map(r => ({
        nodeId: r.nodeId, count: r.count, lastViewedAt: r.lastViewedAt,
        title: titles.get(r.nodeId)?.title || r.nodeId,
        category: titles.get(r.nodeId)?.category || '',
      })),
    };
  }

  // ===== 大纲视图展开状态 =====
  @Get('graph/expansions')
  async getExpansions(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.graphExpansion.findMany({ where: { userId: user.id } });
    return { expanded: rows.map(r => r.nodeId) };
  }

  @Put('graph/expansions')
  async setExpansion(@CurrentUser() user: CurrentUserType, @Body() body: any) {
    const nodeId = String(body.nodeId || '');
    if (!nodeId || nodeId.length > 100) throw new BadRequestException('nodeId 不合法');
    if (body.expanded) {
      await this.prisma.graphExpansion.upsert({
        where: { userId_nodeId: { userId: user.id, nodeId } },
        create: { userId: user.id, nodeId },
        update: {},
      });
    } else {
      await this.prisma.graphExpansion.deleteMany({ where: { userId: user.id, nodeId } });
    }
    return { ok: true };
  }

  @Delete('graph/expansions')
  async clearExpansions(@CurrentUser() user: CurrentUserType) {
    await this.prisma.graphExpansion.deleteMany({ where: { userId: user.id } });
    return { ok: true };
  }

  // ===== 图谱分层（公开读取） =====
  @Get('graph/tiers')
  async getTiers() {
    const rows = await this.prisma.nodeTier.findMany();
    const tiers: Record<string, { tier: number; parentId: string | null }> = {};
    const tier1: string[] = [];
    for (const r of rows) {
      tiers[r.nodeId] = { tier: r.tier, parentId: r.parentId };
      if (r.tier === 1 && !r.parentId) tier1.push(r.nodeId);
    }
    return { tiers, tier1, meta: { method: null, computedAt: null, running: false } };
  }

  // ===== 贡献值 =====
  @Get('contributions/me')
  async contributions(@CurrentUser() user: CurrentUserType) {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const rows = await this.prisma.activity.findMany({
      where: { userName: user.username, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });
    const totalRow = await this.prisma.activity.aggregate({
      where: { userName: user.username },
      _sum: { points: true },
    });
    const days: Record<string, { date: string; points: number; count: number }> = {};
    const byKind: Record<string, number> = {};
    for (const r of rows) {
      const day = r.createdAt.toISOString().slice(0, 10);
      days[day] = days[day] || { date: day, points: 0, count: 0 };
      days[day].points += r.points;
      days[day].count++;
      byKind[r.kind] = (byKind[r.kind] || 0) + r.points;
    }
    return { total: totalRow._sum.points || 0, days: Object.values(days), byKind };
  }

  // ===== AI 知识节点（登录后动态层） =====
  @Get('ai/knowledge')
  async aiKnowledge(@CurrentUser() user: CurrentUserType) {
    const aiNodes = await this.prisma.aiNode.findMany({ orderBy: { createdAt: 'desc' } });
    const merges = await this.prisma.aiMerge.findMany({ orderBy: { id: 'desc' }, take: 40 });
    const reviews = await this.prisma.aiReview.findMany({ orderBy: { id: 'asc' } });
    const colItems = await this.prisma.collectionItem.findMany({ orderBy: { id: 'asc' } });

    const parseArr = (s: string) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
    const knownIds = new Set(aiNodes.map(n => n.id));
    const bundle = await this.prisma.note.findMany({ select: { id: true } });
    bundle.forEach(n => knownIds.add(n.id));

    const reviewsByNode: Record<string, any[]> = {};
    for (const rv of reviews) {
      (reviewsByNode[rv.nodeId] = reviewsByNode[rv.nodeId] || []).push({
        reviewer: rv.reviewer, verdict: rv.verdict, note: rv.note, createdAt: rv.createdAt,
      });
    }

    const collectionItems: Record<string, any[]> = {};
    for (const c of colItems) {
      (collectionItems[c.collectionNodeId] = collectionItems[c.collectionNodeId] || []).push({
        id: c.id, title: c.title, content: c.content,
        tags: parseArr(c.tags), links: parseArr(c.links),
        createdBy: c.createdBy, createdAt: c.createdAt,
      });
    }

    const nodes = aiNodes.map(n => ({
      id: n.id, title: n.title, category: n.category, layer: n.layer,
      status: n.status === 'todo' ? 'todo' : 'learned',
      tags: parseArr(n.tags), links: parseArr(n.links).filter((id: string) => knownIds.has(id)),
      content: n.content, createdAt: n.createdAt, createdBy: n.createdBy,
      submissionId: n.submissionId, profileTags: (()=>{try{return JSON.parse(n.profileTags||'{}')}catch{return{level:'novice',focus:[]}}})(),
      reviews: reviewsByNode[n.id] || [],
    }));

    const mergeList = merges.map(mr => ({
      id: mr.id, targetNodeId: mr.targetNodeId,
      links: parseArr(mr.links).filter((id: string) => knownIds.has(id)),
      content: mr.content, createdAt: mr.createdAt, createdBy: mr.createdBy,
    }));

    const edgeKeys = new Set<string>();
    const edges: { source: string; target: string }[] = [];
    for (const n of nodes) for (const t of n.links) {
      if (!knownIds.has(t)) continue;
      const key = [n.id, t].sort().join('=>');
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: n.id, target: t });
    }
    for (const mr of mergeList) for (const t of mr.links) {
      if (!knownIds.has(t)) continue;
      const key = [mr.targetNodeId, t].sort().join('=>');
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: mr.targetNodeId, target: t });
    }

    return { nodes, merges: mergeList, edges, collectionItems };
  }
}
