import {
  Controller, Get, Patch, Param, Body, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { normalizeProfileTags } from '../auth/profile-tags.util';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(private prisma: PrismaService) {}

  private parseTags(s: string) { try { return normalizeProfileTags(JSON.parse(s)); } catch { return { level: 'novice', focus: [] }; } }

  @Get()
  async list() {
    const rows = await this.prisma.user.findMany({
      orderBy: { id: 'asc' },
    });
    // 超级管理员 = 第一个注册的用户（id 最小），有且仅有一个
    const superId = rows.length ? rows[0].id : -1;
    // 汇总每个用户的 LLM 用量
    const usage = await this.prisma.llmUsage.groupBy({
      by: ['username'],
      _count: { id: true },
      _sum: { promptTokens: true, outputTokens: true },
      _max: { createdAt: true },
    });
    const usageMap = new Map(usage.map(u => [u.username, u]));
    const invites = await this.prisma.inviteCode.findMany();
    const invMap = new Map(invites.map(i => [i.id, i.code]));
    return {
      users: rows.map(u => ({
        id: u.id, username: u.username, nickname: u.nickname || '',
        phone: u.phone || '', email: u.email || '',
        role: u.role, status: u.status, llmBanned: !!u.llmBanned,
        isSuper: u.id === superId,
        createdAt: u.createdAt,
        inviteCode: invMap.get(u.inviteCodeId || 0) || '',
        profileTags: this.parseTags(u.profileTags),
        ...((() => {
          const stat = usageMap.get(u.username);
          return stat ? {
            totalChats: stat._count.id,
            totalTokens: (stat._sum.promptTokens || 0) + (stat._sum.outputTokens || 0),
            lastActive: stat._max.createdAt,
          } : {
            totalChats: 0, totalTokens: 0, lastActive: null,
          };
        })()),
      })),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() body: any, @CurrentUser() me: CurrentUserType) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    const role = body.role !== undefined ? (body.role === 'admin' ? 'admin' : 'user') : user.role;
    const status = body.status !== undefined ? (body.status === 'disabled' ? 'disabled' : 'enabled') : user.status;
    // 超级管理员（第一个注册的用户）不可被撤销管理员、不可被禁用（含自己操作）
    const first = await this.prisma.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
    const isSuper = !!first && first.id === id;
    if (isSuper && role !== 'admin') throw new BadRequestException('超级管理员（第一个注册的用户）不能撤销管理员权限');
    if (isSuper && status === 'disabled') throw new BadRequestException('不能禁用超级管理员');
    if (id === me.id && (status === 'disabled' || role !== 'admin')) {
      throw new BadRequestException('不能禁用或撤销自己的管理员权限');
    }
    let profileTags = user.profileTags;
    if (body.profileTags !== undefined) {
      profileTags = JSON.stringify(normalizeProfileTags(body.profileTags));
    }
    const llmBanned = body.llmBanned !== undefined ? (body.llmBanned ? 1 : 0) : undefined;
    await this.prisma.user.update({
      where: { id },
      data: {
        role, status, profileTags,
        ...(llmBanned !== undefined ? { llmBanned } : {}),
      },
    });
    if (status === 'disabled') {
      await this.prisma.session.deleteMany({ where: { userId: id } });
    }
    return { ok: true, profileTags: this.parseTags(profileTags) };
  }
}
