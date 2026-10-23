import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import * as mammoth from 'mammoth';
import TurndownService from 'turndown';

/** 压缩后的图片（base64 不带 data: 前缀），token 用于公开只读访问 */
export interface CompressedImage {
  mimeType: string;
  base64: string;
  bytes: number;
  width: number;
  height: number;
  token: string;
}

/** 单张图片硬上限：压缩后必须小于 5M */
export const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

/** Word 内嵌插图最多解析张数（超出的在正文中注明） */
export const DOCX_IMAGE_LIMIT = 10;

@Injectable()
export class UploadFileService {
  /** 压缩图片：长边 ≤2048、JPEG q85；仍 ≥5M 再降档 1600px/q70；最终仍 ≥5M 抛错 */
  async compressImage(input: Buffer): Promise<CompressedImage> {
    let buf = await sharp(input).rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (buf.length >= IMAGE_SIZE_LIMIT) {
      buf = await sharp(input).rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
    }
    if (buf.length >= IMAGE_SIZE_LIMIT) throw new Error('图片压缩后仍超过 5M');
    const meta = await sharp(buf).metadata();
    return {
      mimeType: 'image/jpeg',
      base64: buf.toString('base64'),
      bytes: buf.length,
      width: meta.width || 0,
      height: meta.height || 0,
      token: randomBytes(16).toString('hex'),
    };
  }

  /**
   * 解析 .docx：正文转 markdown，内嵌图片以 ![](img-N) 占位（N 为文档中的出现顺序），图片 buffer 单独返回。
   * 图片最多取前 DOCX_IMAGE_LIMIT 张，超出的连同占位符一起丢弃并在文末注明。
   */
  async parseDocx(input: Buffer): Promise<{ markdown: string; images: Buffer[] }> {
    const collected: { idx: number; buf: Buffer }[] = [];
    let seq = 0;
    const { value: html } = await mammoth.convertToHtml(
      { buffer: input },
      {
        convertImage: mammoth.images.imgElement(async (image: any) => {
          const idx = seq++;
          const b64 = await image.readAsBase64String();
          collected.push({ idx, buf: Buffer.from(b64, 'base64') });
          return { src: `img-${idx}` };
        }),
      },
    );
    collected.sort((a, b) => a.idx - b.idx);

    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', hr: '---' });
    let markdown = turndown.turndown(html || '');
    // 清理多余空行
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    let images = collected.map(c => c.buf);
    if (collected.length > DOCX_IMAGE_LIMIT) {
      // 丢弃超限图片的占位符，避免残留无效引用
      markdown = markdown.replace(/!\[[^\]]*\]\(img-(\d+)\)/g, (m, n) =>
        Number(n) < DOCX_IMAGE_LIMIT ? m : '');
      images = images.slice(0, DOCX_IMAGE_LIMIT);
      markdown += `\n\n> 注：原文共 ${collected.length} 张插图，仅解析前 ${DOCX_IMAGE_LIMIT} 张。`;
    }
    if (markdown.length > 60000) {
      markdown = markdown.slice(0, 60000) + '\n\n> 注：正文过长，已截断。';
    }
    return { markdown, images };
  }
}
