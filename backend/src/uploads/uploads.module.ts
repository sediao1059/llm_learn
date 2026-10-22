import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadGraphService } from './upload-graph.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadGraphService],
  exports: [UploadGraphService],
})
export class UploadsModule {}
