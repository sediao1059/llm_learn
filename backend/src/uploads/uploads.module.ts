import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadImagesController } from './upload-images.controller';
import { UploadGraphService } from './upload-graph.service';
import { UploadFileService } from './upload-file.service';

@Module({
  controllers: [UploadsController, UploadImagesController],
  providers: [UploadGraphService, UploadFileService],
  exports: [UploadGraphService],
})
export class UploadsModule {}
