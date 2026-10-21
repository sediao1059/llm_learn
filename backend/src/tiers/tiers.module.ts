import { Module } from '@nestjs/common';
import { TiersController } from './tiers.controller';

@Module({ controllers: [TiersController] })
export class TiersModule {}
