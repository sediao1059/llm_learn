import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { normalizeProfileTags } from '../auth/profile-tags.util';
import { AnnotationsController } from './annotations.controller';

@Controller('admin/annotations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAnnotationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query('status') status: string) {
    const s = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    const rows = await this.prisma.annotation.findMany({
      where: { status: s }, orderBy: { id: 'desc' }, take: 200,
    });
    const helper = new AnnotationsController(this.prisma);
    return { annotations: rows.map(r => (helper as any).pub(r)) };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.annotation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('注释不存在');
    if (row.status !== 'pending') throw new BadRequestException('该注释已处理过');
    const tags = body.profileTags !== undefined
      ? normalizeProfileTags(body.profileTags)
      : (()=>{try{return normalizeProfileTags(JSON.parse(row.profileTags||'{}'))}catch{return{level:'novice',focus:[]}}})();
    await this.prisma.annotation.update({
      where: { id },
      data: { status: 'approved', decidedAt: new Date(), decidedBy: user.username, profileTags: JSON.stringify(tags) },
    });
    await this.prisma.activity.create({
      data: { userName: row.createdBy || '', kind: 'annotation', points: 2, note: `注释审核通过 #${id}` },
    });
    return { ok: true };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.annotation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('注释不存在');
    if (row.status !== 'pending') throw new BadRequestException('该注释已处理过');
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) throw new BadRequestException('请填写驳回理由');
    await this.prisma.annotation.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: user.username, rejectReason: reason },
    });
    return { ok: true };
  }
}
