import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@Controller()
export class TiersController {
  constructor(private prisma: PrismaService) {}

  /** 分层数据（公开，游客可访问） */
  @Get('graph/tiers')
  async getTiers() {
    const rows = await this.prisma.nodeTier.findMany();
    const tiers: Record<string, { tier: number; parentId: string | null }> = {};
    const tier1: string[] = [];
    for (const r of rows) {
      tiers[r.nodeId] = { tier: r.tier, parentId: r.parentId };
      if (r.tier === 1 && !r.parentId) tier1.push(r.nodeId);
    }
    const meta = await this.prisma.appKv.findUnique({ where: { key: 'tiers_last_run' } });
    return {
      tiers, tier1,
      meta: { method: null, computedAt: meta?.value || null, running: false },
    };
  }

  @Post('admin/tiers/recompute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async recompute() {
    // 简化：按分类选 hub + BFS（LLM 版可后续加）
    const nodes = await this.prisma.note.findMany({ select: { id: true, category: true, links: true } });
    const aiNodes = await this.prisma.aiNode.findMany({ select: { id: true, category: true, links: true } });
    const all = [...nodes, ...aiNodes];
    const byId = new Map(all.map(n => [n.id, n]));
    const knownIds = new Set(all.map(n => n.id));

    // 度数计算
    const degree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    for (const n of all) {
      const links: string[] = JSON.parse(n.links || '[]');
      for (const t of links) {
        if (!knownIds.has(t)) continue;
        degree[n.id] = (degree[n.id] || 0) + 1;
        degree[t] = (degree[t] || 0) + 1;
        (adj[n.id] = adj[n.id] || []).push(t);
        (adj[t] = adj[t] || []).push(n.id);
      }
    }
    // 按分类选 hub
    const byCat: Record<string, string[]> = {};
    for (const n of all) (byCat[n.category] = byCat[n.category] || []).push(n.id);
    const tier1: string[] = [];
    for (const cat of Object.keys(byCat).slice(0, 8)) {
      const hub = byCat[cat].sort((a, b) => (degree[b] || 0) - (degree[a] || 0))[0];
      if (hub && !tier1.includes(hub)) tier1.push(hub);
    }
    // BFS
    const tierMap: Record<string, number> = {};
    const parentMap: Record<string, string> = {};
    for (const id of tier1) tierMap[id] = 1;
    let queue = [...tier1];
    while (queue.length) {
      const next: string[] = [];
      for (const u of queue) {
        if (tierMap[u] >= 4) continue;
        for (const v of adj[u] || []) {
          if (tierMap[v] !== undefined) continue;
          tierMap[v] = tierMap[u] + 1;
          parentMap[v] = u;
          next.push(v);
        }
      }
      queue = next;
    }
    // 写库
    await this.prisma.nodeTier.deleteMany();
    const now = new Date();
    for (const id of tier1) {
      await this.prisma.nodeTier.create({ data: { nodeId: id, tier: 1, method: 'algorithm', computedAt: now } });
    }
    for (const [id, tier] of Object.entries(tierMap)) {
      if (tier === 1) continue;
      await this.prisma.nodeTier.create({
        data: { nodeId: id, tier, parentId: parentMap[id] || tier1[0], method: 'algorithm', computedAt: now },
      });
    }
    await this.prisma.appKv.upsert({
      where: { key: 'tiers_last_run' },
      create: { key: 'tiers_last_run', value: now.toISOString() },
      update: { value: now.toISOString() },
    });
    return { ok: true, method: 'algorithm', tier1Count: tier1.length };
  }
}
