import {
  Controller, Get, Post, Delete, Body, Param, Headers, Req, UseGuards,
  BadRequestException, HttpException, HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@Controller()
export class FeedbackController {
  constructor(private prisma: PrismaService) {}

  /** 内存限流记录：IP → 最近提交时间戳 */
  private recent = new Map<string, number[]>();

  /** 同 IP 每分钟最多 5 条，防公开接口被刷 */
  private rateLimited(ip: string): boolean {
    const now = Date.now();
    const list = (this.recent.get(ip) || []).filter((t) => now - t < 60_000);
    if (list.length >= 5) {
      this.recent.set(ip, list);
      return true;
    }
    list.push(now);
    this.recent.set(ip, list);
    return false;
  }

  /** 可选解析 Bearer：有效会话返回用户名，否则 null（游客提交） */
  private async optionalUsername(authHeader?: string): Promise<string | null> {
    if (!authHeader) return null;
    const m = authHeader.match(/^Bearer (\S+)$/);
    if (!m) return null;
    const session = await this.prisma.session.findUnique({
      where: { token: m[1] },
      include: { user: true },
    });
    if (!session || session.user.status !== 'enabled') return null;
    if (session.expiresAt > 0 && Number(session.expiresAt) < Date.now()) return null;
    return session.user.username;
  }

  /** 提交反馈（公开，登录前后都可用；登录时自动关联账号） */
  @Post('feedback')
  async create(
    @Body() body: any,
    @Headers('authorization') auth?: string,
    @Req() req?: Request,
  ) {
    const content = String(body?.content || '').trim().slice(0, 1000);
    const contact = String(body?.contact || '').trim().slice(0, 50);
    if (content.length < 5) throw new BadRequestException('反馈内容至少 5 个字');

    const forwarded = String(req?.headers['x-forwarded-for'] || '');
    const ip = forwarded.split(',')[0].trim() || req?.ip || 'unknown';
    if (this.rateLimited(ip)) {
      throw new HttpException('提交太频繁了，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    const createdBy = await this.optionalUsername(auth);
    await this.prisma.feedback.create({
      data: { content, contact: contact || null, createdBy },
    });
    return { ok: true };
  }

  // ===== 管理端 =====

  @Get('admin/feedback')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async list() {
    const rows = await this.prisma.feedback.findMany({ orderBy: { id: 'desc' }, take: 500 });
    return { list: rows };
  }

  @Delete('admin/feedback/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: number) {
    await this.prisma.feedback.delete({ where: { id } });
    return { ok: true };
  }
}
