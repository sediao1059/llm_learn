import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 上传图片公开只读接口（无鉴权）：markdown 内容里的 <img> 标签带不了 Bearer 头。
 * 用 32 位随机 token 防枚举；图片随知识内容审核通过后本就全员可见。
 */
@Controller('uploads/images')
export class UploadImagesController {
  constructor(private prisma: PrismaService) {}

  @Get(':token')
  async serve(@Param('token') token: string, @Res() res: Response) {
    if (!/^[0-9a-f]{32}$/.test(token)) throw new NotFoundException('图片不存在');
    const row = await this.prisma.uploadImage.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('图片不存在');
    const buf = Buffer.from(row.data, 'base64');
    res.setHeader('content-type', row.mimeType);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('content-length', String(buf.length));
    res.end(buf);
  }
}
