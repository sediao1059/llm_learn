import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { LlmModule } from './llm/llm.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { InvitesModule } from './invites/invites.module';
import { ModelsModule } from './models/models.module';
import { AssistantModule } from './assistant/assistant.module';
import { AnnotationsModule } from './annotations/annotations.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { UploadsModule } from './uploads/uploads.module';
import { PathsModule } from './paths/paths.module';
import { TiersModule } from './tiers/tiers.module';
import { HotModule } from './hot/hot.module';
import { JobsModule } from './jobs/jobs.module';
import { VersionsModule } from './versions/versions.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotesModule } from './notes/notes.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    LlmModule,
    KnowledgeModule,
    AuthModule,
    UsersModule,
    InvitesModule,
    ModelsModule,
    AssistantModule,
    AnnotationsModule,
    SubmissionsModule,
    UploadsModule,
    PathsModule,
    TiersModule,
    HotModule,
    JobsModule,
    VersionsModule,
    AnalyticsModule,
    NotesModule,
    FeedbackModule,
  ],
})
export class AppModule {}
