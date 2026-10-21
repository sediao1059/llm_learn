import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LlmService } from '../llm/llm.service';

function maskKey(key: string) {
  const k = String(key || '');
  if (k.length <= 8) return k ? '****' : '';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

@Controller('llm/models')
@UseGuards(JwtAuthGuard)
export class ModelsController {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
  ) {}

  private pub(r: any) {
    return {
      id: r.id, name: r.name, protocol: r.protocol,
      baseUrl: r.baseUrl, apiKeyMasked: maskKey(r.apiKey),
      modelId: r.modelId, maxTokens: r.maxTokens,
      status: r.status, isGlobal: !!r.isGlobal,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }

  @Get()
  async list() {
    const rows = await this.prisma.llmModel.findMany({
      orderBy: [{ isGlobal: 'desc' }, { id: 'asc' }],
    });
    return { models: rows.map(r => this.pub(r)) };
  }

  @Post()
  async create(@Body() body: any) {
    const name = String(body.name || '').trim();
    const baseUrl = String(body.baseUrl || '').trim();
    const apiKey = String(body.apiKey || '').trim();
    const modelId = String(body.modelId || '').trim();
    if (!name || !baseUrl || !apiKey || !modelId) throw new BadRequestException('名称 / Base URL / API Key / 模型 ID 均不能为空');
    if (!/^https?:\/\//.test(baseUrl)) throw new BadRequestException('Base URL 需以 http(s):// 开头');
    const maxTokens = Number(body.maxTokens) || 8192;
    const protocol = body.protocol === 'anthropic' ? 'anthropic' : 'openai';
    const status = body.status === 'disabled' ? 'disabled' : 'enabled';
    const row = await this.prisma.llmModel.create({
      data: { name, protocol, baseUrl, apiKey, modelId, maxTokens, status },
    });
    // 首个启用的模型自动全局
    const cnt = await this.prisma.llmModel.count({ where: { status: 'enabled' } });
    if (status === 'enabled' && cnt === 1) {
      await this.prisma.llmModel.update({ where: { id: row.id }, data: { isGlobal: 1 } });
    }
    const updated = await this.prisma.llmModel.findUnique({ where: { id: row.id } });
    return { model: this.pub(updated) };
  }

  @Put(':id')
  async update(@Param('id') id: number, @Body() body: any) {
    const existing = await this.prisma.llmModel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('模型不存在');
    const name = body.name !== undefined ? String(body.name || '').trim() : existing.name;
    const baseUrl = body.baseUrl !== undefined ? String(body.baseUrl || '').trim() : existing.baseUrl;
    const apiKey = String(body.apiKey || '').trim() || existing.apiKey;
    const modelId = body.modelId !== undefined ? String(body.modelId || '').trim() : existing.modelId;
    const maxTokens = body.maxTokens !== undefined && body.maxTokens !== '' ? Number(body.maxTokens) : existing.maxTokens;
    const protocol = body.protocol !== undefined ? (body.protocol === 'anthropic' ? 'anthropic' : 'openai') : existing.protocol;
    const status = body.status !== undefined ? (body.status === 'disabled' ? 'disabled' : 'enabled') : existing.status;
    if (!name || !baseUrl || !apiKey || !modelId) throw new BadRequestException('均不能为空');
    const row = await this.prisma.llmModel.update({
      where: { id },
      data: { name, protocol, baseUrl, apiKey, modelId, maxTokens, status },
    });
    if (status === 'disabled' && existing.isGlobal) {
      await this.prisma.llmModel.update({ where: { id }, data: { isGlobal: 0 } });
    }
    return { model: this.pub(row) };
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    await this.prisma.llmModel.delete({ where: { id } });
    return { ok: true };
  }

  @Put(':id/global')
  async setGlobal(@Param('id') id: number) {
    const row = await this.prisma.llmModel.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('模型不存在');
    if (row.status !== 'enabled') throw new BadRequestException('停用状态的模型不能设为全局默认');
    await this.prisma.$transaction([
      this.prisma.llmModel.updateMany({ where: { isGlobal: 1 }, data: { isGlobal: 0 } }),
      this.prisma.llmModel.update({ where: { id }, data: { isGlobal: 1 } }),
    ]);
    return { ok: true };
  }

  @Post(':id/test')
  async test(@Param('id') id: number) {
    const row = await this.prisma.llmModel.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('模型不存在');
    const r = await this.llm.testModel(row as any);
    if (!r.ok) throw new BadRequestException(r.error || '连接失败');
    return r;
  }
}
