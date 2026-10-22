import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [JobsController],
})
export class JobsModule {}
