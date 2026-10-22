import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards,
  BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

/** 单条变更说明：text 正文；hidden=true 时仅管理员在管理页可见，用户端（徽章 hover / 公开接口）不展示 */
type ChangeItem = { text: string; hidden?: boolean };

@Controller()
export class VersionsController {
  constructor(private prisma: PrismaService) {}

  /** 解析 changes 列：兼容两种历史格式——纯字符串数组（旧数据 / 版本台账自动登记，默认用户可见）
   *  与对象数组 { text, hidden } */
  private parseChanges(raw: string): ChangeItem[] {
    let v: any;
    try { v = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(v)) return [];
    return v
      .map((c: any) => (typeof c === 'string'
        ? { text: c.trim() }
        : { text: String(c?.text || '').trim(), hidden: !!c?.hidden }))
      .filter((c: ChangeItem) => c.text);
  }

  /** 用户端可见的变更（纯字符串数组，展示端无需感知可见性结构） */
  private visibleChanges(raw: string): string[] {
    return this.parseChanges(raw).filter((c) => !c.hidden).map((c) => c.text);
  }

  /** 归一化写入：入参接受 string[] 或 [{text,hidden}]，过滤空文本 */
  private normalizeChanges(input: any): ChangeItem[] {
    const arr = Array.isArray(input) ? input : [];
    return arr
      .map((c: any) => (typeof c === 'string'
        ? { text: c.trim() }
        : { text: String(c?.text || '').trim(), hidden: !!c?.hidden }))
      .filter((c: ChangeItem) => c.text);
  }

  private pub(r: any) {
    return { id: r.id, version: r.version, date: r.date, changes: this.visibleChanges(r.changes) };
  }

  /** 公开：全部版本（新→旧；只含用户可见条目，全部条目均不可见的版本整条跳过） */
  @Get('versions')
  async list() {
    const rows = await this.prisma.version.findMany({ orderBy: { id: 'desc' } });
    return { versions: rows.map((r) => this.pub(r)).filter((v) => v.changes.length) };
  }

  /** 公开：最新版本号（顶栏徽章兜底用；最新版本若无可见条目则顺延到下一个） */
  @Get('versions/latest')
  async latest() {
    const rows = await this.prisma.version.findMany({ orderBy: { id: 'desc' } });
    const hit = rows.map((r) => this.pub(r)).find((v) => v.changes.length);
    return hit || { version: '1.0.0', date: '', changes: [] };
  }

  // ===== 管理端 =====

  /** 管理端列表：完整变更说明（含仅管理员可见条目，前端带 🔒 标记） */
  @Get('admin/versions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminList() {
    const rows = await this.prisma.version.findMany({ orderBy: { id: 'desc' } });
    return {
      versions: rows.map((r) => ({
        id: r.id, version: r.version, date: r.date,
        changes: this.parseChanges(r.changes),
      })),
    };
  }

  @Post('admin/versions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async create(@Body() body: any) {
    const version = String(body.version || '').trim().slice(0, 20);
    const date = String(body.date || '').trim().slice(0, 20);
    const changes = this.normalizeChanges(body.changes);
    if (!version) throw new BadRequestException('版本号不能为空');
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new BadRequestException('版本号格式如 1.0.0');
    if (!changes.length) throw new BadRequestException('至少一条变更说明');
    try {
      const r = await this.prisma.version.create({
        data: { version, date, changes: JSON.stringify(changes) },
      });
      return this.pub(r);
    } catch (e: any) {
      if (String(e).includes('Unique')) throw new ConflictException('该版本号已存在');
      throw e;
    }
  }

  @Put('admin/versions/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: number, @Body() body: any) {
    const existing = await this.prisma.version.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('版本不存在');
    const changes = Array.isArray(body.changes)
      ? this.normalizeChanges(body.changes)
      : this.parseChanges(existing.changes);
    if (!changes.length) throw new BadRequestException('至少一条变更说明');
    const r = await this.prisma.version.update({
      where: { id },
      data: {
        version: body.version !== undefined ? String(body.version).slice(0, 20) : existing.version,
        date: body.date !== undefined ? String(body.date).slice(0, 20) : existing.date,
        changes: JSON.stringify(changes),
      },
    });
    return this.pub(r);
  }

  @Delete('admin/versions/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: number) {
    await this.prisma.version.delete({ where: { id } });
    return { ok: true };
  }
}
