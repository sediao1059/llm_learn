import { Module } from '@nestjs/common';
import { AnnotationsController } from './annotations.controller';
import { AdminAnnotationsController } from './admin-annotations.controller';

@Module({ controllers: [AnnotationsController, AdminAnnotationsController] })
export class AnnotationsModule {}
