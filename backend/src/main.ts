import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT || 8080);
  await app.listen(port, '0.0.0.0');
  console.log(`✔ NestJS 服务已启动：http://127.0.0.1:${port}/api`);
}
bootstrap();
