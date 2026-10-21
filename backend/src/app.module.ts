import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { LlmModule } from './llm/llm.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { InvitesModule } from './invites/invites.module';
import { ModelsModule } from './models/models.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AssistantModule } from './assistant/assistant.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    LlmModule,
    AuthModule,
    UsersModule,
    InvitesModule,
    ModelsModule,
    KnowledgeModule,
    AssistantModule,
  ],
})
export class AppModule {}
