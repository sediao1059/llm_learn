import { Module } from '@nestjs/common';
import { AdminNotesController } from './admin-notes.controller';
import { AdminKnowledgeController } from './admin-knowledge.controller';
import { NotesService } from './notes.service';

@Module({ controllers: [AdminNotesController, AdminKnowledgeController], providers: [NotesService] })
export class NotesModule {}
