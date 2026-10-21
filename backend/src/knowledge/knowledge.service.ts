import { Injectable } from '@nestjs/common';
import { gzipSync } from 'zlib';
import { PrismaService } from '../prisma/prisma.service';

const ROUTE_NAMES: Record<string, string> = {
  '1': '① 打底线（新手从这里开始）', '2': '② 训练线',
  '3': '③ 应用线', '4': '④ 推理部署线', '5': '⑤ Agent 线',
};

function parseArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

@Injectable()
export class KnowledgeService {
  private cache: { key: string; json: string; obj: any; gz: Buffer | null } = {
    key: '', json: '', obj: null, gz: null,
  };

  constructor(private prisma: PrismaService) {}

  private async fingerprint(): Promise<string> {
    const r = await this.prisma.note.aggregate({
      _max: { syncedAt: true }, _count: true,
    });
    return `${r._max.syncedAt?.toISOString() || ''}/${r._count}`;
  }

  private computePayload(rows: any[]): any {
    const nodes = rows.map(r => ({
      id: r.id, title: r.title || r.id,
      category: r.category || '未分类', layer: r.layer || '未分层',
      path: r.path || '', route: r.route || '',
      difficulty: r.difficulty || '未标注',
      status: r.status === 'todo' ? 'todo' : 'learned',
      tags: parseArr(r.tags), links: parseArr(r.links), sources: parseArr(r.sources),
      file: r.file || '', updatedAt: String(r.updatedAt || '').slice(0, 10),
      summary: r.summary || '', content: r.content || '',
    }));
    const seenIds = new Set(nodes.map((n: any) => n.id));
    const edgeKeys = new Set<string>();
    const edges: { source: string; target: string }[] = [];
    for (const n of nodes) for (const t of n.links) {
      if (!seenIds.has(t)) continue;
      const key = [n.id, t].sort().join('=>');
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: n.id, target: t });
    }
    const categories = [...new Set(nodes.map((n: any) => n.category))];
    const layers = [...new Set(nodes.map((n: any) => n.layer))]
      .sort((a: string, b: string) => a.localeCompare(b, 'en'));
    const tagCount: Record<string, number> = {};
    for (const n of nodes) for (const t of n.tags) tagCount[t] = (tagCount[t] || 0) + 1;
    const allTags = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));
    const routeMap = new Map<string, any[]>();
    for (const n of nodes) {
      if (!n.path) continue;
      const prefix = n.path.split('.')[0];
      if (!routeMap.has(prefix)) routeMap.set(prefix, []);
      routeMap.get(prefix)!.push(n);
    }
    const routes = [...routeMap.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, ns]) => ({
        id, name: ROUTE_NAMES[id] || ('路线 ' + id),
        steps: ns
          .sort((a, b) => Number(a.path.split('.')[1]) - Number(b.path.split('.')[1]))
          .map(n => n.id),
      }));
    return {
      generatedAt: new Date().toISOString(),
      categories, layers, allTags, routes, nodes, edges,
    };
  }

  async getBundleJson(): Promise<string> {
    const key = await this.fingerprint();
    if (this.cache.json && this.cache.key === key) return this.cache.json;
    const rows = await this.prisma.note.findMany({ orderBy: { id: 'asc' } });
    const obj = this.computePayload(rows as any);
    this.cache = { key, json: JSON.stringify(obj), obj, gz: null };
    return this.cache.json;
  }

  async getBundleObj(): Promise<any> {
    await this.getBundleJson();
    return this.cache.obj;
  }

  async getBundleGz(): Promise<Buffer> {
    await this.getBundleJson();
    if (!this.cache.gz) this.cache.gz = gzipSync(Buffer.from(this.cache.json, 'utf8'));
    return this.cache.gz;
  }
}
