import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';

@Module({ controllers: [SubmissionsController] })
export class SubmissionsModule {}
