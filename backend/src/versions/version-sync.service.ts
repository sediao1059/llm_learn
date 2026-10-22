import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

/** 发布记录台账（仓库内维护，随部署到服务器）：每次功能更新追加一条；
 *  后端启动时把台账中尚未入库的记录自动写入 versions 表（SPEC §4.23）。
 *  - 幂等：按条目 key（缺省 = 内容指纹）去重，重复部署/多环境/多实例并发都不会重复入库；
 *  - 版本号自动递增：从库内最新 x.y.z 按大/中/小三档推进，撞号（版本号唯一约束）自动重算重试。 */
const LEDGER_FILE = path.join(process.cwd(), 'version.releases.json');

type Bump = 'major' | 'minor' | 'patch';
type LedgerEntry = { key?: string; bump?: Bump; date?: string; changes?: string[] };

@Injectable()
export class VersionSyncService implements OnModuleInit {
  private logger = new Logger('VersionSync');

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    let entries: LedgerEntry[] = [];
    try {
      if (existsSync(LEDGER_FILE)) {
        const parsed = JSON.parse(readFileSync(LEDGER_FILE, 'utf-8'));
        if (Array.isArray(parsed)) entries = parsed;
      }
    } catch (e) {
      this.logger.warn(`发布记录台账读取失败，跳过自动登记：${String(e)}`);
      return;
    }
    if (!entries.length) return;

    for (const entry of entries) {
      try {
        await this.syncOne(entry);
      } catch (e) {
        // 单条失败不影响启动与其余条目
        this.logger.error(`发布记录登记失败（${JSON.stringify(entry.changes || []).slice(0, 80)}…）：${String(e)}`);
      }
    }
  }

  /** 条目幂等 key：优先用手工指定的 key，缺省按内容指纹生成（同一条目重复处理得到相同 key） */
  private keyOf(entry: LedgerEntry, changes: string[]): string {
    if (entry.key) return String(entry.key).slice(0, 64);
    const raw = `${entry.date || ''}|${entry.bump || ''}|${JSON.stringify(changes)}`;
    return createHash('sha1').update(raw).digest('hex').slice(0, 16);
  }

  private async syncOne(entry: LedgerEntry) {
    const changes = (entry.changes || [])
      .filter((c) => typeof c === 'string' && c.trim())
      .map((c) => c.trim());
    if (!changes.length) return;

    const key = this.keyOf(entry, changes);
    if (await this.prisma.version.findFirst({ where: { key } })) return; // 已登记过，跳过

    const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')
      ? (entry.date as string)
      : new Date().toISOString().slice(0, 10);

    // 版本号可能被并发实例抢先写入（唯一约束冲突），最多重算重试 3 次
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.prisma.version.findFirst({ orderBy: { id: 'desc' } });
      const next = this.nextVersion(latest?.version, entry.bump);
      try {
        const row = await this.prisma.version.create({
          data: { version: next, date, changes: JSON.stringify(changes), key },
        });
        this.logger.log(`发布记录已自动登记：v${row.version}（${date}，${changes.length} 条变更）`);
        return;
      } catch (e: any) {
        const uniqueHit = e?.code === 'P2002' || String(e).includes('Unique');
        if (!uniqueHit) throw e;
        // key 撞号 = 另一实例已登记同一条目，视为完成
        if (await this.prisma.version.findFirst({ where: { key } })) return;
      }
    }
  }

  /** 语义化版本推进：major 大版本 x+1.0.0 / minor 中版本 x.y+1.0 / patch 小更新 x.y.z+1（缺省） */
  private nextVersion(current: string | null | undefined, bump?: Bump): string {
    const m = (current || '').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return '1.0.0';
    const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (bump === 'major') return `${x + 1}.0.0`;
    if (bump === 'minor') return `${x}.${y + 1}.0`;
    return `${x}.${y}.${z + 1}`;
  }
}
