import { Controller, Get, Post, Param, UseGuards, NotFoundException, ConflictException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

@Controller('admin/jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class JobsController {
  private running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private knowledge: KnowledgeService,
  ) {}

  private jobDefs = [
    { id: 'tiers', name: '图谱分层选举', schedule: '手动', desc: '按度数选分类 hub + BFS 挂靠' },
    { id: 'hot', name: '热门推荐统计', schedule: '手动', desc: '统计近 30 天足迹（>10 票上榜）' },
  ];

  @Get()
  async list() {
    const jobs = [];
    for (const def of this.jobDefs) {
      const last = await this.prisma.appKv.findUnique({ where: { key: `job_${def.id}_last` } });
      jobs.push({ ...def, running: this.running.has(def.id), lastRun: last?.value || null, lastResult: null });
    }
    return { jobs };
  }

  @Post(':id/run')
  async run(@Param('id') id: string) {
    const def = this.jobDefs.find(j => j.id === id);
    if (!def) throw new NotFoundException('任务不存在');
    if (this.running.has(id)) throw new ConflictException('任务正在运行');
    this.running.add(id);
    (async () => {
      try {
        if (id === 'tiers') await this.runTiers();
        else if (id === 'hot') await this.runHot();
        const now = new Date().toLocaleString('sv-SE');
        await this.prisma.appKv.upsert({
          where: { key: `job_${id}_last` },
          create: { key: `job_${id}_last`, value: now },
          update: { value: now },
        });
      } catch (e: any) {
        console.error(`任务 ${id} 失败:`, e?.message);
      } finally {
        this.running.delete(id);
      }
    })();
    return { ok: true, started: true };
  }

  private async runTiers() {
    const nodes = await this.prisma.note.findMany({ select: { id: true, category: true, links: true } });
    const aiNodes = await this.prisma.aiNode.findMany({ select: { id: true, category: true, links: true } });
    const all = [...nodes, ...aiNodes];
    const knownIds = new Set(all.map(n => n.id));
    const degree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    for (const n of all) {
      for (const t of JSON.parse(n.links || '[]')) {
        if (!knownIds.has(t)) continue;
        degree[n.id] = (degree[n.id] || 0) + 1;
        degree[t] = (degree[t] || 0) + 1;
        (adj[n.id] = adj[n.id] || []).push(t);
        (adj[t] = adj[t] || []).push(n.id);
      }
    }
    const byCat: Record<string, string[]> = {};
    for (const n of all) (byCat[n.category] = byCat[n.category] || []).push(n.id);
    const tier1: string[] = [];
    for (const cat of Object.keys(byCat).slice(0, 8)) {
      const hub = byCat[cat].sort((a, b) => (degree[b] || 0) - (degree[a] || 0))[0];
      if (hub && !tier1.includes(hub)) tier1.push(hub);
    }
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
  }

  private async runHot() {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const rows = await this.prisma.viewHistory.findMany({
      where: { lastViewedAt: { gte: since } }, select: { nodeId: true, userId: true },
    });
    const bundle = await this.knowledge.getBundleObj();
    const byId = new Map<string, any>(bundle.nodes.map((n: any) => [n.id, n]));
    const nodeVotes: Record<string, number> = {};
    const seen = new Set<string>();
    for (const r of rows) {
      const key = r.userId + ':' + r.nodeId;
      if (seen.has(key)) continue;
      seen.add(key);
      nodeVotes[r.nodeId] = (nodeVotes[r.nodeId] || 0) + 1;
    }
    const nodes: { id: string; title: string; votes: number }[] = [];
    const tagVotes: Record<string, number> = {};
    for (const [id, votes] of Object.entries(nodeVotes)) {
      const n = byId.get(id);
      if (!n || votes <= 10) continue;
      nodes.push({ id, title: n.title, votes });
      for (const t of n.tags) tagVotes[t] = (tagVotes[t] || 0) + votes;
    }
    nodes.sort((a, b) => b.votes - a.votes);
    const tags = Object.entries(tagVotes)
      .filter(([, v]) => v > 10)
      .map(([tag, votes]) => ({ tag, votes }))
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 10);
    const cache = { computedAt: new Date().toISOString(), minVotes: 10, tags, nodes: nodes.slice(0, 10) };
    await this.prisma.appKv.upsert({
      where: { key: 'hot_cache' },
      create: { key: 'hot_cache', value: JSON.stringify(cache) },
      update: { value: JSON.stringify(cache) },
    });
  }
}

// ============ 面试题注解状态（供管理页展示） ============
import { Controller as _C, Get as _G, UseGuards as _UG } from '@nestjs/common';
