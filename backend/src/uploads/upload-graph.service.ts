import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 上传知识挂图谱：一次上传被 AI 拆解成多条知识时，
 * 审核通过后每条知识各自成为图谱节点（`up-{上传id}-{序号}` 前缀），
 * 全部连向所属「📚 专栏」节点（聚合节点），同一次上传的多条之间两两互连（同源天然相关），
 * 原有指向已有知识点的 links 保留——图谱上呈现「一个聚合节点关联一组知识」的形态。
 *
 * 挂载时机：审核通过时即时挂载（approve 调用）+ 每日 03:25 定时任务幂等兜底（补漏/补历史）。
 * 幂等依据：成员节点 id 由「上传 id + 组内序号」确定，collection_items 顺序即入库顺序，重复执行不产生重复节点。
 */
@Injectable()
export class UploadGraphService {
  constructor(private prisma: PrismaService) {}

  private parseArr(s: string | null | undefined): string[] {
    try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }

  /** 幂等挂载：targetUploadId 省略时全量扫描。返回 { uploads, created } */
  async syncUploadsToGraph(targetUploadId?: number): Promise<{ uploads: number; created: number }> {
    const items = await this.prisma.collectionItem.findMany({
      where: targetUploadId ? { sourceUploadId: targetUploadId } : { sourceUploadId: { not: null } },
      orderBy: [{ id: 'asc' }],
    });
    // 按上传分组（一次审核入库的成员按顺序连续创建，组内 id 升序 = 入库顺序）
    const groups = new Map<number, { colId: string; items: typeof items }>();
    for (const it of items) {
      if (it.sourceUploadId == null) continue;
      const g = groups.get(it.sourceUploadId) || { colId: it.collectionNodeId, items: [] as typeof items };
      g.items.push(it);
      groups.set(it.sourceUploadId, g);
    }

    let created = 0;
    for (const [uploadId, g] of groups) {
      const colExists = await this.prisma.aiNode.findUnique({ where: { id: g.colId }, select: { id: true } });
      if (!colExists) continue; // 专栏节点被删则跳过（成员无处挂靠）

      const memberIds = g.items.map((_, i) => `up-${uploadId}-${i}`);
      let anyCreated = false;
      for (let i = 0; i < g.items.length; i++) {
        const it = g.items[i];
        const nodeId = memberIds[i];
        const dup = await this.prisma.aiNode.findUnique({ where: { id: nodeId }, select: { id: true } });
        if (dup) continue;
        const links = [...new Set([
          ...this.parseArr(it.links),          // 原有指向已有知识点的关联
          g.colId,                              // 连向聚合（专栏）节点
          ...memberIds.filter(x => x !== nodeId), // 同一次上传的多条之间互连
        ])].slice(0, 20);
        await this.prisma.aiNode.create({
          data: {
            id: nodeId, title: it.title.slice(0, 160),
            category: '📚 专栏', layer: '未分层',
            tags: JSON.stringify(this.parseArr(it.tags).slice(0, 6)),
            content: it.content, links: JSON.stringify(links),
            createdBy: it.createdBy, profileTags: it.profileTags,
          },
        });
        created++;
        anyCreated = true;
      }

      if (anyCreated) {
        // 聚合节点（专栏）links 追加成员，形成「聚合节点关联多条」的连线
        const col = await this.prisma.aiNode.findUnique({ where: { id: g.colId } });
        if (col) {
          const colLinks = this.parseArr(col.links);
          const merged = [...new Set([...colLinks, ...memberIds])].slice(0, 40);
          if (merged.length !== colLinks.length) {
            await this.prisma.aiNode.update({
              where: { id: g.colId }, data: { links: JSON.stringify(merged) },
            });
          }
        }
      }
    }
    return { uploads: groups.size, created };
  }

  /** 每日 03:25 幂等兜底（错开 02:30 分层选举 / 03:10 缓存预热 / 03:40 热门统计） */
  @Cron('0 25 3 * * *')
  async daily() {
    try {
      const r = await this.syncUploadsToGraph();
      await this.prisma.appKv.upsert({
        where: { key: 'job_upload-graph_last' },
        create: { key: 'job_upload-graph_last', value: new Date().toLocaleString('sv-SE') },
        update: { value: new Date().toLocaleString('sv-SE') },
      });
      console.log(`[upload-graph] 每日挂载完成：${r.uploads} 组上传，新建 ${r.created} 个节点`);
    } catch (e: any) {
      console.error('[upload-graph] 每日挂载失败:', e?.message);
    }
  }
}
