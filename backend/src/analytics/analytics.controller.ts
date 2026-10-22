import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AnalyticsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async getAnalytics() {
    const [
      totalUsers, totalNotes, totalAiNodes, totalChats, totalMessages,
      totalAnnotations, totalUploads, totalUsage,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.note.count(),
      this.prisma.aiNode.count(),
      this.prisma.aiChat.count(),
      this.prisma.aiMessage.count(),
      this.prisma.annotation.count(),
      this.prisma.upload.count(),
      this.prisma.llmUsage.aggregate({ _sum: { promptTokens: true, outputTokens: true } }),
    ]);

    // 近 7 天活跃用户
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const activeUsers7d = await this.prisma.llmUsage.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      distinct: ['username'], select: { username: true },
    });

    // 近 30 天每日活跃度
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recentUsage = await this.prisma.llmUsage.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, promptTokens: true, outputTokens: true },
    });
    const dailyMap: Record<string, { messages: number; tokens: number }> = {};
    for (const u of recentUsage) {
      const day = u.createdAt.toISOString().slice(0, 10);
      dailyMap[day] = dailyMap[day] || { messages: 0, tokens: 0 };
      dailyMap[day].messages++;
      dailyMap[day].tokens += u.promptTokens + u.outputTokens;
    }
    const dailyActivity: { date: string; messages: number; tokens: number; annotations: number }[] = Object.entries(dailyMap)
      .map(([date, v]) => ({ date, annotations: 0, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 近 30 天注解数（按天）
    const recentAnnos = await this.prisma.annotation.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
    });
    const annoMap: Record<string, number> = {};
    for (const a of recentAnnos) {
      const day = a.createdAt.toISOString().slice(0, 10);
      annoMap[day] = (annoMap[day] || 0) + 1;
    }
    for (const d of dailyActivity) d.annotations = annoMap[d.date] || 0;

    // Top 用户（按 token 用量）
    const topUsage = await this.prisma.llmUsage.groupBy({
      by: ['username'],
      _count: { id: true },
      _sum: { promptTokens: true, outputTokens: true },
      _max: { createdAt: true },
      orderBy: { _sum: { outputTokens: 'desc' } },
      take: 10,
    });
    const topUsers = topUsage.map(u => ({
      username: u.username,
      chats: u._count.id,
      tokens: (u._sum.promptTokens || 0) + (u._sum.outputTokens || 0),
      lastActive: u._max.createdAt,
    }));

    // 知识分类分布
    const notes = await this.prisma.note.findMany({ select: { category: true } });
    const aiNodes = await this.prisma.aiNode.findMany({ select: { category: true } });
    const catCount: Record<string, number> = {};
    for (const n of [...notes, ...aiNodes]) {
      catCount[n.category] = (catCount[n.category] || 0) + 1;
    }
    const categoryDistribution = Object.entries(catCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      overview: {
        totalUsers,
        activeUsers7d: activeUsers7d.length,
        totalNotes,
        totalAiNodes,
        totalChats,
        totalMessages,
        totalAnnotations,
        totalUploads,
        totalTokens: (totalUsage._sum.promptTokens || 0) + (totalUsage._sum.outputTokens || 0),
      },
      dailyActivity,
      topUsers,
      categoryDistribution,
    };
  }
}
