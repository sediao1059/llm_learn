import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { NotesService } from './notes.service';

/** 手工笔记管理（MySQL 为唯一创作源头，2026-10 起 notes/ 文件链路废弃） */
@Controller('admin/notes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminNotesController {
  constructor(private prisma: PrismaService, private notesService: NotesService) {}

  /** 元数据列表（不含正文；编辑时走详情接口取全文） */
  @Get()
  async list(@Query('q') q?: string, @Query('category') category?: string) {
    const where: any = {};
    if (category) where.category = category;
    if (q) where.OR = [{ id: { contains: q } }, { title: { contains: q } }, { summary: { contains: q } }];
    const notes = await this.prisma.note.findMany({
      where,
      orderBy: { id: 'asc' },
      select: {
        id: true, title: true, category: true, layer: true, path: true, route: true,
        difficulty: true, status: true, tags: true, links: true, sources: true,
        updatedAt: true, summary: true, syncedAt: true,
      },
    });
    const catRows = await this.prisma.note.findMany({
      distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' },
    });
    return { notes, categories: catRows.map(r => r.category) };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.notesService.detailForEdit(id);
  }

  @Post()
  async create(@Body() body: any) {
    return this.notesService.create(body);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.notesService.update(id, body);
  }

  /** 知识库页难度列的内联修改：只动 difficulty 一个字段（留空 = 未标注），不动 updatedAt（最近更新列表不抖动） */
  @Patch(':id/difficulty')
  async updateDifficulty(@Param('id') id: string, @Body() body: any) {
    const v = String(body?.difficulty ?? '').trim();
    if (!['', '入门', '进阶', '深入'].includes(v)) {
      throw new BadRequestException('难度只能是 入门/进阶/深入，留空为「未标注」');
    }
    if (!await this.prisma.note.findUnique({ where: { id } })) {
      throw new NotFoundException('笔记不存在');
    }
    await this.prisma.note.update({
      where: { id },
      data: { difficulty: v || '未标注', syncedAt: new Date() },
    });
    return { ok: true, difficulty: v || '未标注' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.notesService.remove(id);
  }
}
