import { Injectable, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { randomBytes, scryptSync } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeProfileTags } from './profile-tags.util';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  private hashPassword(password: string, salt: string) {
    return scryptSync(password, salt, 64).toString('hex');
  }

  private async createSession(userId: number): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.prisma.session.create({ data: { token, userId, expiresAt: 0 } });
    return token;
  }

  async register(body: {
    username: string; password: string; inviteCode?: string; level?: string; focus?: string[];
    nickname?: string; phone?: string; email?: string;
  }) {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username.length < 2 || username.length > 20) throw new BadRequestException('用户名需 2–20 个字符');
    if (!/^[\w\u4e00-\u9fa5.-]+$/.test(username)) throw new BadRequestException('用户名仅支持中英文、数字、._-');
    if (password.length < 4 || password.length > 64) throw new BadRequestException('密码需 4–64 个字符');

    const hasAdmin = await this.prisma.user.findFirst({ where: { role: 'admin' } });
    let inviteCodeId: number | null = null;
    if (hasAdmin) {
      const code = String(body.inviteCode || '').trim();
      if (!code) throw new BadRequestException('现在注册需要邀请码，请向管理员索取');
      const inv = await this.prisma.inviteCode.findFirst({ where: { code, status: 'enabled' } });
      if (!inv) throw new BadRequestException('邀请码无效或已停用');
      inviteCodeId = inv.id;
    }

    const profile = normalizeProfileTags({ level: body.level, focus: body.focus });
    const nickname = String(body.nickname || '').trim().slice(0, 60);
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim().slice(0, 120);
    if (phone && !/^1\d{10}$/.test(phone)) throw new BadRequestException('手机号格式不对（11 位数字）');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('邮箱格式不正确');

    const role = hasAdmin ? 'user' : 'admin';
    const salt = randomBytes(16).toString('hex');
    try {
      const user = await this.prisma.user.create({
        data: {
          username,
          passwordHash: this.hashPassword(password, salt),
          salt, role, inviteCodeId,
          profileTags: JSON.stringify(profile),
          nickname, phone, email,
        },
      });
      if (inviteCodeId) {
        await this.prisma.inviteCode.update({
          where: { id: inviteCodeId },
          data: { useCount: { increment: 1 } },
        });
      }
      // 注册默认学习路线（模板生成，不调 LLM）
      try {
        const route = this.buildDefaultRoute(profile);
        await this.prisma.learningPath.create({
          data: {
            title: '我的默认学习路线',
            goal: '注册时按画像自动生成，可删除',
            tree: JSON.stringify(route),
            createdBy: username,
          },
        });
      } catch { /* 路线失败不影响注册 */ }

      const token = await this.createSession(user.id);
      return { token, username, nickname, role, profileTags: profile };
    } catch (e: any) {
      if (String(e).includes('Unique')) throw new ConflictException('用户名已被注册');
      throw e;
    }
  }

  async login(body: { username: string; password: string }) {
    const user = await this.prisma.user.findUnique({
      where: { username: String(body.username || '').trim() },
    });
    if (!user || this.hashPassword(String(body.password || ''), user.salt) !== user.passwordHash) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.status !== 'enabled') throw new UnauthorizedException('账号已被禁用，请联系管理员');
    const token = await this.createSession(user.id);
    return {
      token,
      username: user.username,
      nickname: user.nickname || '',
      role: user.role,
      profileTags: JSON.parse(user.profileTags || '{}'),
    };
  }

  async logout(token: string) {
    await this.prisma.session.deleteMany({ where: { token } });
    return { ok: true };
  }

  async updateProfile(userId: number, body: {
    nickname?: string; phone?: string; email?: string;
    level?: string; focus?: string[];
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const profile = normalizeProfileTags({
      level: body.level ?? JSON.parse(user.profileTags || '{}').level,
      focus: body.focus ?? JSON.parse(user.profileTags || '{}').focus,
    });
    const nickname = body.nickname !== undefined ? String(body.nickname || '').trim().slice(0, 60) : (user.nickname || '');
    const phone = body.phone !== undefined ? String(body.phone || '').trim() : (user.phone || '');
    const email = body.email !== undefined ? String(body.email || '').trim().slice(0, 120) : (user.email || '');
    if (phone && !/^1\d{10}$/.test(phone)) throw new BadRequestException('手机号格式不对');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('邮箱格式不正确');

    await this.prisma.user.update({
      where: { id: userId },
      data: { profileTags: JSON.stringify(profile), nickname, phone, email },
    });
    return { profileTags: profile, nickname, phone, email };
  }

  /** 按画像生成默认路线树（模板，不调 LLM） */
  private buildDefaultRoute(profile: { level: string; focus: string[] }) {
    const expert = profile.level === 'expert';
    const stages = expert
      ? [
          { title: '阶段一 · 应用开发', goal: '生产级 RAG 与工具编排', items: [] },
          { title: '阶段二 · 训练与部署', goal: '动得了模型本身', items: [] },
        ]
      : [
          { title: '阶段一 · 打好基础', goal: '按打底线把地基打牢', items: [] },
          { title: '阶段二 · 入门应用', goal: '学会用大模型干活', items: [] },
        ];
    return {
      title: '我的默认学习路线',
      summary: expert ? '根据你的老手画像生成的默认路线' : '根据你的新手画像生成的入门路线',
      stages,
    };
  }
}
