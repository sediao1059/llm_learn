import { Module } from '@nestjs/common';
import { InvitesController } from './invites.controller';

@Module({ controllers: [InvitesController] })
export class InvitesModule {}
