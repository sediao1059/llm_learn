import { Controller, Post, Get, Put, Body, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, CurrentUserType } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 内存限流记录：动作:IP → 最近时间戳（登录/注册防刷，防撞库与批量注册） */
  private attempts = new Map<string, number[]>();

  /** 同 IP 每分钟限次：登录 10 次、注册 5 次，超出拒绝 */
  private tooManyAttempts(kind: 'login' | 'register', ip: string): boolean {
    const limit = kind === 'login' ? 10 : 5;
    const now = Date.now();
    const key = `${kind}:${ip}`;
    const list = (this.attempts.get(key) || []).filter((t) => now - t < 60_000);
    if (list.length >= limit) {
      this.attempts.set(key, list);
      return true;
    }
    list.push(now);
    this.attempts.set(key, list);
    return false;
  }

  private clientIp(req: any): string {
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '');
    return forwarded.split(',')[0].trim() || req?.ip || 'unknown';
  }

  @Post('register')
  async register(@Body() body: any, @Request() req: any) {
    if (this.tooManyAttempts('register', this.clientIp(req))) {
      throw new HttpException('注册太频繁了，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.authService.register(body);
  }

  @Post('login')
  async login(@Body() body: any, @Request() req: any) {
    if (this.tooManyAttempts('login', this.clientIp(req))) {
      throw new HttpException('登录尝试太频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.authService.login(body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req: any) {
    const m = String(req.headers['authorization'] || '').match(/^Bearer (\S+)$/);
    return this.authService.logout(m?.[1] || '');
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: CurrentUserType) {
    return {
      username: user.username,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      role: user.role,
      profileTags: user.profileTags,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(@CurrentUser() user: CurrentUserType, @Body() body: any) {
    return this.authService.updateProfile(user.id, body);
  }
}
