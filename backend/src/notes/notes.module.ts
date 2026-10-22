import { Module } from '@nestjs/common';
import { AdminNotesController } from './admin-notes.controller';
import { NotesService } from './notes.service';

@Module({ controllers: [AdminNotesController], providers: [NotesService] })
export class NotesModule {}
