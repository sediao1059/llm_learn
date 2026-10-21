import { Module } from '@nestjs/common';
import { CoreCrudController } from './core-crud.controller';
import { AdminUsersController } from './admin.controller';

@Module({ controllers: [CoreCrudController, AdminUsersController] })
export class UsersModule {}
