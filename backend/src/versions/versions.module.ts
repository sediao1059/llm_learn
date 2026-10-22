import { Module } from '@nestjs/common';
import { VersionsController } from './versions.controller';
import { VersionSyncService } from './version-sync.service';

@Module({ controllers: [VersionsController], providers: [VersionSyncService] })
export class VersionsModule {}
