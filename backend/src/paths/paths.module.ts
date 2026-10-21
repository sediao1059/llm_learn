import { Module } from '@nestjs/common';
import { PathsController } from './paths.controller';

@Module({ controllers: [PathsController] })
export class PathsModule {}
