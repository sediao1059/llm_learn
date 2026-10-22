import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmQueueController } from './llm-queue.controller';

@Global()
@Module({
  controllers: [LlmQueueController],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
