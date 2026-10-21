import { Controller, Get, Res, Headers } from '@nestjs/common';
import { Response } from 'express';
import { KnowledgeService } from './knowledge.service';

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
}
