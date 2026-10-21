export interface JwtPayload {
  sub: number;
  username: string;
  role: string;
  nickname?: string;
}
