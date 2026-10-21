# llm_learn — 大模型技术学习仓库

个人大模型（LLM）技术学习项目：**知识点笔记 + 可交互知识图谱 + AI 全局助手**。

> **贡献者 / AI 助手必读**：修改本项目任何代码前，先读 [AGENTS.md](AGENTS.md)（协作规范）与 [SPEC.md](SPEC.md)（产品需求规范，本项目功能需求的唯一事实来源）。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | **NestJS 10 + Prisma + MySQL**（TypeScript，46 个源文件） |
| 前端 | **React 18 + Ant Design 5 + Vite**（TypeScript，28 个源文件） |
| 图谱 | ECharts 5 |
| LLM | 双协议客户端（openai 兼容 / anthropic），SSE 流式 |

## 目录结构

```
llm_learn/
├── backend/               # NestJS 后端（端口 8080）
│   ├── src/               # 16 个业务模块
│   ├── prisma/schema.prisma  # 25 张表完整模型
│   └── package.json
├── frontend/              # React 前端（端口 3000，dev 代理到 8080）
│   ├── src/pages/         # graph / paths / upload / admin 四页
│   ├── src/components/    # 共享组件（KnowledgeDrawer / MarkdownContent 等）
│   └── src/store/        # Zustand 状态（auth）
├── notes/                 # 学习笔记（创作源头，一个知识点 = 一个 md 文件）
├── SPEC.md / AGENTS.md / README.md
└── .gitignore
```

## 快速启动

```bash
# 1. 后端
cd backend
cp .env.example .env   # 编辑数据库连接
npm install
npx prisma db push
npm run start:dev       # → http://127.0.0.1:8080/api

# 2. 前端
cd frontend
npm install
npm run dev             # → http://127.0.0.1:3000
```

## 主要功能

- **知识图谱**：ECharts 力导向图，点击节点打开笔记 Drawer（Markdown 渲染 + 划词注释 + 放大阅读 + 学习程度标记）
- **学习路线**：左侧路线卡片（进度圆环）+ 右侧树形学习视图（阶段折叠 + 主题标记 + 路线内导航），AI 定制/调整，支持知识点扩展加入路线
- **AI 助手**：共享会话 + SSE 流式对话（画像分层提示词），回答可沉淀为知识点
- **上传知识**：链接/文本 → AI 拆解成知识点 → 管理员审核 → 专栏入库，贡献计分
- **管理中心**（9 个页签）：用户（含 AI 禁用/用量统计）/ 邀请码 / 沉淀审核 / 上传审核 / 面试题 / 学习路线 / 定时任务 / 版本管理 / 报表统计
- **用户体系**：注册（邀请码 + 画像 + 默认路线）/ 登录（可勾选记住账号密码，存本机浏览器）/ 角色 / 禁用 / AI 禁用 / 资料编辑
- **版本管理**：顶栏版本徽章 + 更新日志 Timeline + 管理端 CRUD

## Git

- 远程仓库：https://gitee.com/sediaoopen/llm_learn.git
