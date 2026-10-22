import { Injectable } from '@nestjs/common';
import { gzipSync } from 'zlib';
import { PrismaService } from '../prisma/prisma.service';

export const ROUTE_NAMES: Record<string, string> = {
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

  /** 「最近更新」可选登录：带有效会话才合并 AI 沉淀层（与图谱动态层可见性一致，无效会话静默降级为仅静态笔记） */
  private async hasValidSession(authHeader?: string): Promise<boolean> {
    if (!authHeader) return false;
    const m = authHeader.match(/^Bearer (\S+)$/);
    if (!m) return false;
    const session = await this.prisma.session.findUnique({
      where: { token: m[1] },
      include: { user: true },
    });
    return !!session && session.user.status === 'enabled'
      && !(session.expiresAt > 0 && Number(session.expiresAt) < Date.now());
  }

  /** 「最近更新」列表：实时查 MySQL（静态笔记 notes + 登录后 AI 沉淀 ai_nodes + ai_merges 补充时间），按最近动态时间从新到旧 */
  async getRecent(authHeader?: string) {
    const withAi = await this.hasValidSession(authHeader);
    const minuteText = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

    const notes = await this.prisma.note.findMany({
      orderBy: { updatedAt: 'desc' }, take: 200,
      select: { id: true, title: true, category: true, layer: true, tags: true, updatedAt: true },
    });
    let aiNodes: {
      id: string; title: string; category: string; layer: string | null;
      tags: string; createdAt: Date; updatedAt: Date; createdBy: string | null;
    }[] = [];
    let merges: { targetNodeId: string; createdAt: Date }[] = [];
    if (withAi) {
      [aiNodes, merges] = await Promise.all([
        this.prisma.aiNode.findMany({
          orderBy: { updatedAt: 'desc' }, take: 200,
          select: { id: true, title: true, category: true, layer: true, tags: true, createdAt: true, updatedAt: true, createdBy: true },
        }),
        this.prisma.aiMerge.findMany({
          orderBy: { createdAt: 'desc' }, take: 100,
          select: { targetNodeId: true, createdAt: true },
        }),
      ]);
    }

    // 每个节点最近一次「AI 补充」的时间（merges 已按时间倒序，首次出现即最新）
    const latestMerge = new Map<string, Date>();
    for (const mr of merges) if (!latestMerge.has(mr.targetNodeId)) latestMerge.set(mr.targetNodeId, mr.createdAt);

    const sourceOf = (id: string) =>
      id.startsWith('up-') ? 'upload' : id.startsWith('col-') ? 'collection' : id.startsWith('ai-') ? 'ai' : 'note';

    const items: any[] = [];
    for (const n of notes) {
      if (!n.updatedAt) continue; // 从未同步过更新日期的旧数据不进最近列表
      const dayMs = Date.parse(`${n.updatedAt.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(dayMs)) continue;
      const mergeAt = latestMerge.get(n.id);
      const useMerge = !!mergeAt && mergeAt.getTime() > dayMs;
      items.push({
        id: n.id, title: n.title, category: n.category || '未分类', layer: n.layer || '未分层',
        tags: parseArr(n.tags), source: 'note',
        kind: useMerge ? 'supplemented' : 'updated',
        time: useMerge ? mergeAt!.toISOString() : new Date(dayMs).toISOString(),
        timeText: useMerge ? minuteText(mergeAt!) : n.updatedAt.slice(0, 10),
      });
    }
    for (const n of aiNodes) {
      // 创建后一分钟内没再动过视为「新增」，否则是被编辑/合并过的「更新」
      const base = new Date(Math.max(n.createdAt.getTime(), n.updatedAt.getTime()));
      let kind = n.updatedAt.getTime() - n.createdAt.getTime() < 60_000 ? 'added' : 'updated';
      let t = base;
      const mergeAt = latestMerge.get(n.id);
      if (mergeAt && mergeAt.getTime() > base.getTime()) { kind = 'supplemented'; t = mergeAt; }
      items.push({
        id: n.id, title: n.title, category: n.category || '未分类', layer: n.layer || '未分层',
        tags: parseArr(n.tags), source: sourceOf(n.id), kind,
        time: t.toISOString(), timeText: minuteText(t), createdBy: n.createdBy || '',
      });
    }
    items.sort((a, b) => b.time.localeCompare(a.time) || a.title.localeCompare(b.title, 'zh'));
    return { items, includesAi: withAi };
  }
}
