import { Module } from '@nestjs/common';
import { HotController } from './hot.controller';

@Module({ controllers: [HotController] })
export class HotModule {}
