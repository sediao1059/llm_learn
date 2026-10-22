import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { LlmService } from './llm.service';

/**
 * 模型排队状态接口：前端在 LLM 同步调用（非流式）等待期间轮询它，
 * 发现自己有排队票据就提示「前面还有几个、预计等多久」；也供观察各模型并发概况。
 */
@Controller('llm')
@UseGuards(JwtAuthGuard)
export class LlmQueueController {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
  ) {}

  @Get('queue')
  async status(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.llmModel.findMany({
      select: { protocol: true, modelId: true, name: true },
    });
    const names = new Map(rows.map(r => [
      `${r.protocol === 'anthropic' ? 'anthropic' : 'openai'}:${r.modelId}`,
      r.name,
    ]));
    return this.llm.queueSnapshot(user.id, k => names.get(k) || k.split(':')[1] || k);
  }
}
