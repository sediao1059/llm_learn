# llm_learn — 大模型技术学习仓库

个人大模型（LLM）技术学习项目：**知识点笔记 + 可交互知识图谱 + AI 全局助手**。

**作者**：色调 · 联系邮箱：[sediao666@qq.com](mailto:sediao666@qq.com)

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

## 部署（llm.fixbug.fun）

线上环境：阿里云 CentOS 7（139.196.151.20），部署目录 `/usr/local/llm_learn`，MySQL 5.7（同机 Docker），nginx 托管前端静态资源并反代 `/api`。

> 服务器两条红线决定了部署形态：① CentOS 7 的 glibc 2.17 跑不了原生 Node 18+/Prisma 6；② Docker 1.13（glibc 2.36 的 bookworm 容器会因 `clone3` 系统调用被老 seccomp 拦截而崩）。因此后端构建与运行都在 **`node:20-bullseye-slim` 容器**里（glibc 2.31 兼容），镜像由 `deploy.sh` 在服务器缺失时自动「本地拉取 → save → ssh load」导入（老 Docker 拉不动新镜像）。

```bash
./deploy.sh back    # rsync 后端源码+笔记 → 服务器容器内 npm install/构建/db push/笔记入库 → 重启容器
./deploy.sh front   # 本地构建前端 → rsync dist
./deploy.sh all     # back + front
```

- 前置：本机已配 SSH 公钥免密登录 root@139.196.151.20；服务器 `/usr/local/llm_learn/backend/.env`（DATABASE_URL / JWT_SECRET / PORT，人工维护、不入库）。
- 每次 `back` 部署自动执行：`prisma db push`（幂等同步表结构）+ `node dist/scripts/build.js`（notes/*.md 同步入库，含面试题注解提取）。
- 后端容器 `llm-learn-backend`（`--restart unless-stopped`），与 mysql 容器同在 `llm-net` 网络（数据库主机名 `mysql`），仅监听 `127.0.0.1:9100`；nginx 配置在 `/etc/nginx/conf.d/llm.fixbug.fun.conf`（`/api/` 反代已为 SSE 关闭缓冲）。
- 注意：tsconfig 同时包含 `src/` 与 `scripts/`，编译产物在 `dist/src/main.js`（运行入口），`dist/scripts/build.js` 为笔记同步脚本。

## 主要功能

- **知识图谱**：ECharts 力导向图，点击节点打开笔记 Drawer（Markdown 渲染 + 划词注解 + 放大阅读 + 学习程度标记）；画布空白处按住拖拽即平移（全画布生效）、滚轮缩放；注解以知乎风荧光高亮内嵌在正文中（已审核=黄色高亮 / 自己待审核=高亮+橙虚线，高频面试题带 💼），点击高亮弹出注解阅读弹窗，弹窗内是知乎式讨论区——可针对整条注解向 AI 提问（SSE 流式，问答对沉淀共享）或发表评论（即时全员可见）；关联知识点标签点击即在抽屉内跳转打开；未生成面试题的笔记在正文末尾点击即 AI 流式出题（生成后全员共享、下次秒开）
- **学习路线**：左侧路线卡片（进度圆环）+ 右侧树形学习视图（阶段折叠 + 主题标记 + 路线内导航），AI 定制/调整，支持知识点扩展加入路线；「新主题」点击即懒加载——SSE 流式生成 markdown 学习内容（边流边渲染），生成后缓存进路线、下次秒开，可重新生成；生成的内容同样支持划词注解（选中→💡解答→存注解→荧光高亮阅读，与图谱笔记一致）
- **AI 助手（顶栏 💬）**：右侧滑出抽屉，全员共享会话池（记录提问人、任何人可续聊，可重命名/删除）；SSE 流式打字机输出（💭 思考过程折叠展示），对话模型可临时切换并本地记忆；每条回答可「✨ 沉淀为知识点」——管理员预览（AI 与全部已有知识点对比判断新建/合并）→ 确认直写图谱，普通用户填星级表单提交审核（进度看顶栏「📥 沉淀」）
- **个人学习工具（顶栏）**：🕘 足迹（最近浏览 200 条，点击回到那篇笔记）/ ⭐ 收藏（笔记面板 ☆ 一键收藏，跨设备跟随账号）/ 💡 注解（我划词沉淀过的全部注解，含审核状态）/ 📥 沉淀（我提交的知识点进度）
- **上传知识**：链接/文本 → AI 拆解成知识点 → 管理员审核 → 专栏入库，贡献计分
- **管理中心**（10 个页签）：用户（含 AI 禁用/用量统计/👑 超级管理员保护）/ ⚙ 模型配置（双协议 CRUD、真发一句话测试连接、全局默认互斥切换）/ 邀请码 / 沉淀审核 / 上传审核 / 面试题 / 学习路线 / 定时任务 / 版本管理 / 报表统计
- **用户体系**：注册（邀请码 + 画像 + 默认路线）/ 登录（可勾选记住账号密码，存本机浏览器）/ 角色（第一个注册的用户是超级管理员，不可禁用/不可撤管；其他管理员由管理页分配）/ 禁用 / AI 禁用 / 资料编辑
- **版本管理**：顶栏版本徽章（hover 浮窗直接展示本次更新内容，无需点开弹窗）+ 管理端 CRUD
- **开发者联系方式**：顶栏右侧常驻邮箱链接（✉ sediao666@qq.com，点击唤起邮件客户端）

## Git

- 远程仓库：https://gitee.com/sediaoopen/llm_learn.git
