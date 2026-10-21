import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserType {
  id: number;
  username: string;
  nickname: string;
  phone: string;
  email: string;
  role: string;
  status: string;
  profileTags: { level: string; focus: string[] };
}

export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext): CurrentUserType => {
    const request = ctx.switchToHttp().getRequest();
    return data ? request.user?.[data] : request.user;
  },
);
