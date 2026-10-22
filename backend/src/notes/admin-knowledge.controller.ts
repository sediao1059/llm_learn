import {
  Controller, Patch, Param, Body, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

/**
 * 知识元数据内联修改（知识库页管理员用）：难度 + 层次，手工笔记（notes）与
 * AI 沉淀/上传/专栏节点（ai_nodes）统一一个入口——前端不用区分节点类型。
 * 只动 difficulty / layer 两个字段，不动 updatedAt（「最近更新」列表不抖动）。
 */
@Controller('admin/knowledge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminKnowledgeController {
  constructor(private prisma: PrismaService) {}

  @Patch(':id/meta')
  async updateMeta(@Param('id') id: string, @Body() body: any) {
    const hasDifficulty = body?.difficulty !== undefined;
    const hasLayer = body?.layer !== undefined;
    if (!hasDifficulty && !hasLayer) {
      throw new BadRequestException('至少要改一个字段：difficulty 或 layer');
    }
    const difficulty = String(body.difficulty ?? '').trim();
    const layer = String(body.layer ?? '').trim();
    if (hasDifficulty && !['', '入门', '进阶', '深入'].includes(difficulty)) {
      throw new BadRequestException('难度只能是 入门/进阶/深入，留空为「未标注」');
    }
    if (hasLayer && layer.length > 40) {
      throw new BadRequestException('层次名称太长（最多 40 字）');
    }

    const data: any = {};
    if (hasDifficulty) data.difficulty = difficulty || '未标注';
    if (hasLayer) data.layer = layer || '未分层';

    const note = await this.prisma.note.findUnique({ where: { id } });
    if (note) {
      // syncedAt 跟着动让图谱 bundle 缓存失效；updatedAt（字符串日期）不动
      await this.prisma.note.update({ where: { id }, data: { ...data, syncedAt: new Date() } });
      return { ok: true, source: 'note', ...data };
    }

    const aiNode = await this.prisma.aiNode.findUnique({ where: { id } });
    if (aiNode) {
      // 显式回传旧 updatedAt，避免 @updatedAt 自动刷新导致「最近更新」列表抖动
      await this.prisma.aiNode.update({ where: { id }, data: { ...data, updatedAt: aiNode.updatedAt } });
      return { ok: true, source: 'aiNode', ...data };
    }

    throw new NotFoundException('知识点不存在');
  }
}
