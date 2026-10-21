import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards,
  BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';

@Controller('admin/invites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class InvitesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.inviteCode.findMany({ orderBy: { id: 'desc' } });
    return {
      invites: rows.map(r => ({
        id: r.id, code: r.code, note: r.note, status: r.status,
        useCount: r.useCount, createdBy: r.createdBy, createdAt: r.createdAt,
      })),
    };
  }

  @Post()
  async create(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const code = String(body.code || '').trim().toUpperCase() || randomBytes(6).toString('hex').toUpperCase();
    const note = String(body.note || '').trim().slice(0, 100);
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) throw new BadRequestException('邀请码仅支持 4–32 位大写字母/数字/连字符');
    try {
      const r = await this.prisma.inviteCode.create({ data: { code, note, createdBy: user.username } });
      return { invite: { id: r.id, code: r.code, note: r.note, status: r.status, useCount: r.useCount, createdBy: r.createdBy, createdAt: r.createdAt } };
    } catch (e: any) {
      if (String(e).includes('Unique')) throw new ConflictException('邀请码已存在');
      throw e;
    }
  }

  @Patch(':id')
  async toggle(@Param('id') id: number, @Body() body: any) {
    const inv = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('邀请码不存在');
    const status = body.status === 'disabled' ? 'disabled' : 'enabled';
    const note = body.note !== undefined ? String(body.note || '').trim().slice(0, 100) : inv.note;
    await this.prisma.inviteCode.update({ where: { id }, data: { status, note } });
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    await this.prisma.inviteCode.delete({ where: { id } });
    return { ok: true };
  }
}
