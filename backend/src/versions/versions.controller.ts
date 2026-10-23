import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards,
  BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@Controller()
export class VersionsController {
  constructor(private prisma: PrismaService) {}

  /** 解析 changes 列：字符串数组（常规/台账自动登记）；兼容历史按条可见性对象数组（自动降级取 text） */
  private parseChanges(raw: string): string[] {
    let v: any;
    try { v = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(v)) return [];
    return v
      .map((c: any) => (typeof c === 'string' ? c.trim() : String(c?.text || '').trim()))
      .filter(Boolean);
  }

  private pub(r: any) {
    return { id: r.id, version: r.version, date: r.date, changes: this.parseChanges(r.changes) };
  }

  /** 公开：全部版本（新→旧；设为不可见的版本整条不出现） */
  @Get('versions')
  async list() {
    const rows = await this.prisma.version.findMany({ where: { hidden: 0 }, orderBy: { id: 'desc' } });
    return { versions: rows.map((r) => this.pub(r)) };
  }

  /** 公开：最新版本号（顶栏徽章兜底用；最新版本若不可见则顺延到下一个） */
  @Get('versions/latest')
  async latest() {
    const r = await this.prisma.version.findFirst({ where: { hidden: 0 }, orderBy: { id: 'desc' } });
    return r ? this.pub(r) : { version: '1.0.0', date: '', changes: [] };
  }

  // ===== 管理端 =====

  /** 管理端列表：含不可见版本（前端带 🔒 标记） */
  @Get('admin/versions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminList() {
    const rows = await this.prisma.version.findMany({ orderBy: { id: 'desc' } });
    return {
      versions: rows.map((r) => ({
        id: r.id, version: r.version, date: r.date,
        hidden: !!r.hidden, changes: this.parseChanges(r.changes),
      })),
    };
  }

  @Post('admin/versions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async create(@Body() body: any) {
    const version = String(body.version || '').trim().slice(0, 20);
    const date = String(body.date || '').trim().slice(0, 20);
    const changes = this.parseChanges(JSON.stringify(Array.isArray(body.changes) ? body.changes : []));
    if (!version) throw new BadRequestException('版本号不能为空');
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new BadRequestException('版本号格式如 1.0.0');
    if (!changes.length) throw new BadRequestException('至少一条变更说明');
    try {
      const r = await this.prisma.version.create({
        data: { version, date, changes: JSON.stringify(changes), hidden: body.hidden ? 1 : 0 },
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
      ? this.parseChanges(JSON.stringify(body.changes))
      : this.parseChanges(existing.changes);
    if (!changes.length) throw new BadRequestException('至少一条变更说明');
    const r = await this.prisma.version.update({
      where: { id },
      data: {
        version: body.version !== undefined ? String(body.version).slice(0, 20) : existing.version,
        date: body.date !== undefined ? String(body.date).slice(0, 20) : existing.date,
        changes: JSON.stringify(changes),
        ...(body.hidden !== undefined ? { hidden: body.hidden ? 1 : 0 } : {}),
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
