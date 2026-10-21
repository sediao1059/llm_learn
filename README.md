# llm_learn — 大模型技术学习仓库

个人大模型（LLM）技术学习项目：**知识点笔记 + 可交互知识图谱 + AI 全局助手**。

> **贡献者 / AI 助手必读**：修改本项目任何代码前，先读 [AGENTS.md](AGENTS.md)（协作规范）与 [SPEC.md](SPEC.md)（产品需求规范，本项目功能需求的唯一事实来源）。

## 技术栈（2026-10-21 全量重写）

| 层 | 技术 |
|---|---|
| 后端 | **NestJS 10 + Prisma + MySQL**（TypeScript） |
| 前端 | **React 18 + Ant Design 5 + Vite**（TypeScript） |
| 图谱渲染 | ECharts 5 |
| LLM | 双协议客户端（openai 兼容 / anthropic），SSE 流式 |

## 目录结构

```
llm_learn/
├── backend/               # NestJS 后端（端口 8080）
│   ├── src/               # 全部模块（TypeScript）
│   │   ├── auth/          # 注册/登录/JWT 守卫/角色守卫
│   │   ├── users/         # 用户管理 + 进度/收藏/笔记/足迹/贡献值 CRUD
│   │   ├── invites/       # 邀请码管理
│   │   ├── models/        # LLM 模型管理（CRUD + 全局默认 + 测试连通）
│   │   ├── llm/           # LLM 客户端（双协议 SSE 流式）
│   │   ├── knowledge/     # 知识 bundle（gzip 压缩下发）
│   │   ├── assistant/     # AI 助手（共享会话 + SSE 流式对话）
│   │   └── prisma/        # Prisma 数据库服务
│   ├── prisma/schema.prisma  # 24 张表完整模型定义
│   └── package.json
├── frontend/              # React 前端（端口 3000，dev 代理到 8080）（规划中）
├── notes/                 # 学习笔记（一个知识点 = 一个 md 文件，创作源头）
├── graph/                 # 旧版（Vue + 原生 JS，保留备用，待前端迁移后删除）
├── SPEC.md                # 产品需求规范
├── AGENTS.md              # 协作规范
└── README.md
```

## 快速启动

```bash
# 1. 配置数据库连接
cd backend
cp .env.example .env
# 编辑 .env 设置你的 MySQL 连接

# 2. 安装依赖 + 同步数据库
npm install
npx prisma db push

# 3. 启动后端
npm run start:dev
# → http://127.0.0.1:8080/api
```

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` · `/login` | 注册（邀请码+画像） / 登录 |
| GET | `/api/auth/me` · PUT `/api/auth/profile` | 当前用户 / 改画像与资料 |
| GET | `/api/knowledge/bundle` · `/bundle.json` | 知识下发（gzip / JSON） |
| GET/PUT | `/api/progress` · `/api/favorites` · `/api/notes` | 进度 / 收藏 / 个人笔记 |
| POST/GET | `/api/history` | 浏览足迹 |
| GET | `/api/contributions/me` | 贡献值（90 天热力图数据） |
| GET | `/api/ai/knowledge` | AI 知识节点 + 补充 + 派生边 |
| GET/POST | `/api/ai/chats` | 共享会话管理 |
| POST | `/api/ai/chats/:id/messages` | 发消息（SSE 流式回复） |
| GET/POST | `/api/llm/models` | LLM 模型增删改查 |
| GET/PATCH | `/api/admin/users` · `/api/admin/invites` | 管理端 |

## Git

- 远程仓库：https://gitee.com/sediaoopen/llm_learn.git
