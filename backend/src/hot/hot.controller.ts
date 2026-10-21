import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { KnowledgeService } from '../knowledge/knowledge.service';

const HOT_MIN_VOTES = 10;

@Controller()
export class HotController {
  constructor(
    private prisma: PrismaService,
    private knowledge: KnowledgeService,
  ) {}

  @Get('hot')
  async getHot() {
    const cached = await this.prisma.appKv.findUnique({ where: { key: 'hot_cache' } });
    if (cached) {
      try { return JSON.parse(cached.value); } catch {}
    }
    return { computedAt: null, minVotes: HOT_MIN_VOTES, tags: [], nodes: [] };
  }

  @Post('admin/hot/recompute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async recompute() {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const rows = await this.prisma.viewHistory.findMany({
      where: { lastViewedAt: { gte: since } },
      select: { nodeId: true, userId: true },
    });
    const bundle = await this.knowledge.getBundleObj();
    const byId = new Map<string, any>(bundle.nodes.map((n: any) => [n.id as string, n] as [string, any]));
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
      if (!n || votes <= HOT_MIN_VOTES) continue;
      nodes.push({ id, title: n.title, votes });
      for (const t of n.tags) tagVotes[t] = (tagVotes[t] || 0) + votes;
    }
    nodes.sort((a, b) => b.votes - a.votes);
    const tags = Object.entries(tagVotes)
      .filter(([, v]) => v > HOT_MIN_VOTES)
      .map(([tag, votes]) => ({ tag, votes }))
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 10);
    const cache = {
      computedAt: new Date().toISOString(), minVotes: HOT_MIN_VOTES,
      tags, nodes: nodes.slice(0, 10),
    };
    await this.prisma.appKv.upsert({
      where: { key: 'hot_cache' },
      create: { key: 'hot_cache', value: JSON.stringify(cache) },
      update: { value: JSON.stringify(cache) },
    });
    return cache;
  }
}
