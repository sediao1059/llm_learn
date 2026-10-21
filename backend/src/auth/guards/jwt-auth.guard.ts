import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Bearer token 守卫：从 sessions 表校验，附带用户信息 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth = String(request.headers['authorization'] || '');
    const m = auth.match(/^Bearer (\S+)$/);
    if (!m) throw new UnauthorizedException('未登录');

    const session = await this.prisma.session.findUnique({
      where: { token: m[1] },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException('会话无效');
    if (session.expiresAt > 0 && Number(session.expiresAt) < Date.now()) {
      throw new UnauthorizedException('会话已过期');
    }
    if (session.user.status !== 'enabled') {
      throw new UnauthorizedException('账号已被禁用');
    }

    request.user = {
      id: session.user.id,
      username: session.user.username,
      nickname: session.user.nickname || '',
      phone: session.user.phone || '',
      email: session.user.email || '',
      role: session.user.role,
      status: session.user.status,
      llmBanned: !!session.user.llmBanned,
      profileTags: this.parseProfileTags(session.user.profileTags),
    };
    return true;
  }

  private parseProfileTags(s: string) {
    try {
      const v = JSON.parse(s);
      return {
        level: v.level === 'expert' ? 'expert' : 'novice',
        focus: Array.isArray(v.focus) ? v.focus : [],
      };
    } catch {
      return { level: 'novice', focus: [] };
    }
  }
}
