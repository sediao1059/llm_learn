import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

/** 引导规则（SPEC §4.8）：系统还没有管理员时，把最早注册的用户提为管理员 */
async function bootstrapAdmin(prisma: PrismaService) {
  try {
    const hasAdmin = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (hasAdmin) return;
    const first = await prisma.user.findFirst({ orderBy: { id: 'asc' } });
    if (!first) return;
    await prisma.user.update({ where: { id: first.id }, data: { role: 'admin' } });
    console.log(`✔ 引导：暂无管理员，已把最早注册用户「${first.username}」提为管理员`);
  } catch (e: any) {
    console.warn('⚠ 管理员引导失败（数据库暂不可用？）：' + String(e?.message || e));
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT || 8080);
  await app.listen(port, '0.0.0.0');
  await bootstrapAdmin(app.get(PrismaService));
  console.log(`✔ NestJS 服务已启动：http://127.0.0.1:${port}/api`);
}
bootstrap();
