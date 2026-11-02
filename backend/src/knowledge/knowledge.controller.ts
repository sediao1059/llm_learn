import { Controller, Get, Res, Headers, Param, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { KnowledgeService } from './knowledge.service';

/** HTML 转义（拼分享卡片页时一律过它） */
const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

@Controller('knowledge')
export class KnowledgeController {
  constructor(private knowledge: KnowledgeService) {}

  @Get('bundle')
  async bundle(@Res() res: Response) {
    const gz = await this.knowledge.getBundleGz();
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': gz.length,
      'Cache-Control': 'no-store',
      'X-Bundle-Encoding': 'gzip',
    });
    res.end(gz);
  }

  @Get('bundle.json')
  async bundleJson(@Res() res: Response) {
    const json = await this.knowledge.getBundleJson();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(json);
  }

  /** 单篇笔记正文（公开；bundle 只含元数据，打开笔记浮窗时按需拉取） */
  @Get('note-content/:id')
  async noteContent(@Param('id') id: string) {
    const content = await this.knowledge.getNoteContent(id);
    if (content === null) return { id, content: '' };
    return { id, content };
  }

  /** 最近更新的知识（公开；带有效登录态时合并 AI 沉淀层，无效会话静默降级） */
  @Get('recent')
  async recent(@Headers('authorization') auth?: string) {
    return this.knowledge.getRecent(auth);
  }

  /**
   * 知识分享落地页（公开）：返回带该篇「标题 + 摘要 + 站点图标」meta 的 HTML——
   * 微信 / QQ 等抓取 meta 生成卡片，真人打开时 JS 自动跳回图谱页（/?node=）。
   */
  @Get('share/:id')
  async share(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const meta = await this.knowledge.getShareMeta(id);
    // 知识不存在（已删除 / 未入库）：直接跳回图谱首页
    if (!meta) {
      return res.redirect(302, `/?node=${encodeURIComponent(id)}`);
    }
    const host = String(req.headers.host || '');
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
    const base = process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : '');
    const summary = meta.summary || 'LLM 学习知识图谱里的一篇知识';
    const title = `${meta.title} · LLM 学习知识图谱`;
    const home = `/?node=${encodeURIComponent(id)}`;
    const nodeParam = JSON.stringify(encodeURIComponent(id));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(summary)}" />
<link rel="icon" href="/favicon.png" />
<meta property="og:title" content="${esc(meta.title)}" />
<meta property="og:description" content="${esc(summary)}" />
<meta property="og:type" content="article" />
${base ? `<meta property="og:image" content="${esc(base)}/logo.png" />
<meta property="og:url" content="${esc(base + req.originalUrl)}" />` : ''}
<meta name="twitter:card" content="summary" />
</head>
<body style="font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; margin: 0;">
<div style="max-width: 560px; margin: 0 auto; padding: 48px 20px; color: #333;">
  <h1 style="font-size: 20px; margin: 0 0 12px;">${esc(meta.title)}</h1>
  <p style="font-size: 14px; line-height: 1.8; color: #555; margin: 0 0 24px;">${esc(summary)}</p>
  <a href="${esc(home)}" style="display: inline-block; background: #1677ff; color: #fff; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-size: 14px;">打开这篇知识 →</a>
  <p style="font-size: 12px; color: #999; margin-top: 28px;">来自 LLM 学习知识图谱</p>
</div>
<script>location.replace('/?node=' + ${nodeParam});</script>
</body>
</html>`);
  }
}
