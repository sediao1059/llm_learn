import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/** 检查用户是否被禁止使用大模型能力（不影响浏览知识图谱等基础功能） */
@Injectable()
export class LlmBanGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    // 读取类接口（注解列表/高亮、共享会话记录等）不受禁AI影响，只拦生成/写入类
    if (req.method === 'GET') return true;
    if (req.user?.llmBanned) {
      throw new ForbiddenException('管理员已禁止您使用 AI 功能（浏览知识图谱不受影响），如有疑问请联系管理员');
    }
    return true;
  }
}
