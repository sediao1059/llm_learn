import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/** 检查用户是否被禁止使用大模型能力（不影响浏览知识图谱等基础功能） */
@Injectable()
export class LlmBanGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (user?.llmBanned) {
      throw new ForbiddenException('管理员已禁止您使用 AI 功能（浏览知识图谱不受影响），如有疑问请联系管理员');
    }
    return true;
  }
}
