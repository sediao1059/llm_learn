# llm_learn — 大模型技术学习仓库

个人大模型（LLM）技术学习项目：**知识点笔记 + 可交互知识图谱 + AI 全局助手**。

> **贡献者 / AI 助手必读**：修改本项目任何代码前，先读 [AGENTS.md](AGENTS.md)（协作规范）与 [SPEC.md](SPEC.md)（产品需求规范，本项目功能需求的唯一事实来源）。

- 每学一个新知识点，就在 `notes/` 下写一篇带 frontmatter 的 markdown 笔记；
- 运行一条构建命令，`graph/` 前端项目就会把它变成知识图谱上的一个节点；
- 打开 `graph/index.html`，点击节点即可阅读对应知识点的学习内容；
- 随时向 AI 助手提问，回答可一键沉淀为知识点，并与已有知识自动整合去重（见 SPEC.md）。

## 目录结构

```
llm_learn/
├── notes/                 # 全部学习笔记（一个知识点 = 一个 md 文件，创作源头）
│   └── 01-agent/          # 按主题分类的目录（编号仅用于排序，分类以 frontmatter 为准）
├── graph/                 # 知识图谱前端 + 后端（原生 JS + ECharts，后端仅依赖 mysql2）
│   ├── index.html         # 首页：知识图谱（boot.js 拉取压缩知识数据后加载）
│   ├── admin.html         # 管理中心（仅管理员）：用户 / 邀请码 / 沉淀审核 / 图谱分层
│   ├── paths.html         # AI 学习路线页：和 AI 对话生成可迭代的学习路线
│   ├── upload.html        # 上传知识页：发链接/贴文本，AI 拆解后经审核进专栏
│   ├── build.mjs          # 同步脚本：扫描 notes/ 增量同步进 MySQL（不再生成静态 js）
│   ├── server.mjs         # 单文件后端（分发）；ai/admin/tiers/knowledge/db 为能力模块
│   ├── config/db.json     # 数据库占位配置（提交 git）；真实配置在 db.local.json（不提交）
│   └── js/ css/           # 渲染与交互代码
├── SPEC.md                # 产品需求规范（必读）
├── AGENTS.md              # 协作规范（AI 助手与贡献者必读）
├── README.md
└── .gitignore
```

## 数据库（MySQL）

- 连接配置两层：`graph/config/db.json`（空值占位，随仓库提交）+ `graph/config/db.local.json`（真实连接，**不提交 git**）；`DB_ENV=dev|prod`（默认 dev）选节，环境变量 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` 优先级最高
- dev / prod 目前共用本地实例 127.0.0.1:3306（库 `llm_learn`）；部署服务器时改 prod 节即可
- 首次启动/构建会自动建库建表；旧 SQLite（graph/data/app.db）数据用 `cd graph && npm run migrate-sqlite` 一次性迁入（每表目标非空自动跳过，可重复执行）

## 如何新增一个学习点（三步）

1. **写笔记**：在 `notes/<分类目录>/` 下新建 `xxx.md`，文件头带上 frontmatter（模板见下）。
   - 学完了 → `status: learned`；只是先立个"衍生学习/待学"的坑 → `status: todo`（图谱上会以半透明虚线节点显示）。
2. **同步入库**：`cd graph && npm run build`（等价 `node build.mjs`）：按 id 增量同步进 MySQL，删掉的笔记也会从库里删除；服务下次请求自动感知并重建缓存。
3. **查看**：启动 `npm start` 打开图谱点击节点学习；节点间连线由 `links` 字段生成。

## frontmatter 模板

```markdown
---
id: my-new-topic                    # 节点 ID，唯一（不填则默认用文件名）
title: 我的新知识点                    # 图谱节点显示名
category: Agent 系统                 # 维度A·领域分类（决定节点颜色，可自由新增）
layer: L3-应用工程层                 # 维度B·技术层次（L1算法底层/L2大模型底层/L3应用工程层/L4业务应用层）
tags: [Agent, 检索]                  # 标签（用于搜索与标签筛选）
status: learned                     # learned=已学习 / todo=待学习（衍生学习坑位）
links: [manus-multi-step-execution] # 关联的其他知识点 id（生成连线）
sources:                            # 参考资料（markdown 链接）
  - [标题](https://example.com)
---

正文开始，这里写学习内容（Markdown 任意写，支持表格、代码块、ASCII 图）。
```

> 项目规范：[SPEC.md](SPEC.md)（产品需求规范）· [AGENTS.md](AGENTS.md)（协作约定）· [docs/knowledge-dimensions-plan.md](docs/knowledge-dimensions-plan.md)（知识五维模型）· [docs/content-style-guide.md](docs/content-style-guide.md)（内容与文案规范：双受众 + 大白话）。

## 知识图谱说明

- 启动服务：`cd graph && npm start`，访问 http://127.0.0.1:8080（Node ≥ 22；`PORT`/`HOST`/`DB_ENV`/`DB_*` 环境变量可覆盖，部署时可 `HOST=0.0.0.0`；首次启动需 MySQL 可达并已 `npm install`）
  - **注册/登录**后可为每个知识点标注学习程度（未学习/了解/熟悉/掌握），节点外圈按程度着色，顶栏统计已学比例
  - 学习进度、浏览足迹、注释等全部动态数据存 MySQL，多用户相互独立
- **知识压缩下发与离线**（无需登录）：页面数据走 `GET /api/knowledge/bundle`（gzip，前端解压）+ IndexedDB 本地缓存（秒开、省流量、断网可用缓存）；顶栏「⬇ 离线包」可下载**单文件网页**（自带全部知识点与渲染器），拷到没网的电脑双击就能看；服务端每天凌晨 03:10 预热缓存
- 交互：节点可拖拽、滚轮缩放、搜索过滤；**标签条可多选筛选**（选中状态保留，与搜索叠加）；**大纲 / 力导向 / 分层 / 路线**视图切换
- **大纲视图（首页默认）**：首屏只看第一层枢纽节点，点一下展开下一层并看笔记、再点收起，层间不连线不乱；展开进度按用户存服务端，刷新不丢
  - 分层由**每晚 02:30 的选举任务**维护：优先用配置的全局大模型「选举」，没配模型或结果不合法时自动降级为普通算法（分类 hub + 图距离挂靠）；管理员可在管理页手动重算；`npm run build` 后自动感知节点变化
- 点击节点 → 右侧面板显示笔记全文、所属层次与分类、学习程度标注、关联知识点（可继续点击跳转）与参考资料；右上角 ⛶ 可全屏放大阅读（A−/A＋ 字号）
- `status: todo` 的节点在图上呈半透明虚线边框，代表「衍生学习」待办，学完后改状态并重新构建即可
- **浏览足迹**：登录后顶栏「🕘 足迹」看自己最近看过的知识点（仅自己可见），点一下回去接着看
- **收藏与个人笔记**：笔记右上角 ☆ 收藏（顶栏「⭐ 收藏」随时找回）；每篇可写「📝 我的笔记」（仅自己可见，随账号保存）
- **🔥 大家都在看**：每晚统计近 30 天浏览（单人同一篇算 1 次、超过 10 次上榜）生成高频标签与推荐文章；管理员可在「🛡 管理 → 定时任务」查看全部后台任务并手动立即执行（分层选举/缓存预热/热门统计）
- **划词注释**：读笔记时选中一段文字 → 浮窗「💡 解答」→ AI 解释后存成注释：原文画上下划线，别人点开就能读（实线=已审核大家可见；虚线=自己的待审核）；也支持整篇注释；注释定位靠「原文+第几次出现+前后文」，正文大改后定位失败的注释保留在「本篇注释」列表里
- **高频面试题（注释式呈现）**：笔记正文里的「💼 高频面试题」标题可点击展开面试题与参考答案——有该章节的笔记由 `npm run build` 自动提取成注释；缺的由管理员在「🛡 管理 → 面试题」一键用 AI 基于笔记内容补全（后台批量生成，只出笔记里有的知识）

## 账号体系：角色、邀请码、用户画像与审核（需启动服务）

- **角色**：管理员 / 普通用户。系统还没有管理员时，新注册用户自动成为管理员（已有库升级会把最早注册用户提为管理员）
- **用户画像**：注册时选「🐣 新手 / 🦅 老手」（默认新手），之后顶栏「⚙ 我的」随时改，还可多选方向偏好（应用与RAG / Agent开发 / 训练微调 / 推理部署，选项可持续扩充）
  - **新手**：AI 助手用大白话和生活化例子回答、术语带翻译；学习路线从打地基排起
  - **老手**：AI 直接给专业细节、参数与工程取舍；路线跳过入门直击进阶；方向偏好会被路线优先深入
  - 沉淀（知识提交 / AI 节点 / 划词注释）都会留存当时的画像标签；管理员审核时可修正，用户管理页也能单独编辑任意用户画像
- **邀请码**：有了管理员之后，注册必须持管理员发放的邀请码（可重复使用、可停用），在 `admin.html → 邀请码` 管理；用户列表能看到每个人注册用的码
- **用户管理**：管理员可启用/禁用账号（禁用立即全端下线）、调整角色、编辑画像
- **沉淀审核流**：普通用户在 AI 助手里点「✨ 沉淀为知识点」填小表单（星级 1–5 + 备注）提交，管理员在 `admin.html → 沉淀审核` 里「AI 提取并预览」后决定通过（新建/合并进图谱）或驳回（给理由）；提交者在自己顶栏「📥 沉淀中心」看进度
  - 管理员自己的沉淀免审，直接预览→确认→写入
  - AI 沉淀的知识点右上角有审核标识（⏳ 待审核 / ✅ 已审核·N），一篇文章可被多位管理员审核

## AI 学习路线（paths.html，登录可用）

- 顶栏「🗺 学习路线」进入：输入学习目标，AI 基于图谱里**已有的知识点**排一条多层树形路线（阶段→主题→子主题）
- 不满意继续提要求（「少一点数学」「加实战」）迭代调整；满意后保存，左侧列表随时打开
- 路线里映射到已有知识点的条目可一键跳回图谱首页打开那篇笔记
- **官方路线**：管理页可把路线设为官方（学习路线页置顶 + ⭐ 徽章，**直接选择就能学**）；支持「从链接导入官方路线」——抓一篇文章 → AI 转成阶段化路线 → 文章涉及但图谱没有的主题自动建为「待学」节点补进图谱；`npm run seed-paths` 预置 3 条官方路线（入门全景 / 应用开发 / 训练微调）与 5 个资源型待学节点（HuggingFace、Kaggle、LangChain、LoRA、ArXiv）

## 上传知识与专栏（upload.html，登录可用）

- 顶栏「📤 上传知识」进入（与提问解答的 💬 助手分开）：**发链接**（服务端抓正文：直连 → r.jina.ai 渲染代理两级降级；知乎等被拦时明确提示复制正文改贴文本）或**贴大段文本**
- AI 自动**拆解**成 1~5 个知识点：扩写/格式化 + **生成检索标签**（进全站标签筛选）+ 关联已有节点 + 专栏归属建议；页面轮询进度，「我的上传」看全状态（拆解中→待审核→已入库/被驳回）
- 管理员在 `admin.html → 上传审核` 编辑条目/标签/关联、删减、改专栏归属后通过入库：相似主题自动/手动合并成「📚 **专栏**」节点（图谱只保留专栏一个节点），点开专栏看多篇成员文章（多位创建人）
- **贡献体系**：上传入库 +8/篇、沉淀通过 +5、划词注释通过 +2；上传页与「⚙ 我的」展示 90 天贡献热力日历（排行榜页规划中）

## AI 全局助手 · 模型管理 · 知识点沉淀（需启动服务并登录）

基于 LLM 的三个联动功能（全部零依赖实现，移植自 bussiness-platform 的模型管理 + LlmClient 设计）：

### 1. 模型管理（顶栏 ⚙ 模型）

- 配置任意 openai 兼容（DeepSeek / GLM / Qwen / GPT…）或 anthropic（Claude）模型：名称 / 协议 / Base URL / API Key / 模型 ID / 最大输出 tokens / 启停
- 行内可「测试连接」（真发一句话验证）、「设为全局默认」（全表互斥，首个启用的模型自动成为全局）
- API Key 明文存本地 SQLite（`graph/data/app.db`，不入库），列表脱敏显示

### 2. 全局助手（顶栏 💬 助手，右侧滑出抽屉）

- 看图谱的同时随时向 AI 提问；回答流式打字机输出（SSE），思考过程折叠展示
- **会话全员共享**：所有人可见所有提问记录（团队问答池），任何人都可续聊，上下文自动携带最近 20 条
- 抽屉顶部可切换对话模型（默认全局模型，选择本地记忆）

### 3. 知识点沉淀与自动整合（每条回答下「✨ 沉淀为知识点」）

- 点击后服务端把**全部已有知识点摘要**（静态笔记 + 历史 AI 沉淀 + 历史 AI 补充）连同该问答交给 LLM 判断：
  - **主题已有**（不同人问法/细节不同但重复）→ 合并进该知识点，只补充新信息
  - **全新主题** → 新建知识点（自动归类、选层次 L1–L4、挑标签、建立与已有节点的关联）
- 先弹预览（新建/合并徽标 + 理由 + 内容 + 关联，标题可改），**确认后**才写入
- AI 新节点在图上带 ✨ 前缀与「AI 沉淀」徽标；合并内容以「✨ AI 补充」区块追加在对应笔记面板末尾；均支持学习程度标注与删除

### 相关 API 一览（除标注外均需 Bearer 登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | 注册（有管理员后需 `inviteCode`，可带 `level`）/ 登录（返回 role + profileTags） |
| GET | `/api/auth/me` | 当前用户（含 role + profileTags） |
| PUT | `/api/auth/profile` | 个人中心：修改自己的画像（level + focus） |
| GET/PUT | `/api/progress` | 学习程度标注 |
| POST/GET | `/api/history` | 浏览足迹上报 / 查询（每人最近 200 条） |
| GET | `/api/hot` | 热门推荐缓存（**公开**：高频标签 + 推荐文章） |
| GET/PUT | `/api/favorites` | 知识点收藏列表 / 开关（仅自己可见） |
| GET/PUT | `/api/notes` | 个人笔记按节点读取 / 保存（≤10000 字） |
| GET | `/api/admin/jobs` · POST `/api/admin/jobs/:id/run` | 定时任务清单 / 手动立即执行 |
| GET | `/api/graph/tiers` | 大纲视图分层结果（**公开**，游客可访问） |
| GET/PUT/DELETE | `/api/graph/expansions` | 大纲视图展开状态（按用户持久化；DELETE 全部收起） |
| GET | `/api/knowledge/bundle` · `/bundle.json` · `/offline` | 知识下发（**公开**）：gzip / JSON 兜底 / 单文件离线包 |
| POST | `/api/ai/annotations/ask` | 划词解答生成（全局模型，不落库） |
| POST/GET | `/api/ai/annotations`；DELETE `/api/ai/annotations/:id` | 存为注释（管理员免审）/ 按节点查可见注释 / 删除（作者或管理员） |
| GET/POST | `/api/llm/models`；PUT/DELETE `/api/llm/models/:id` | 模型增删改查（key 脱敏） |
| PUT | `/api/llm/models/:id/global` · POST `/api/llm/models/:id/test` | 设全局默认 · 测连通 |
| GET/POST | `/api/ai/chats`；PATCH/DELETE `/api/ai/chats/:id` | 共享会话管理 |
| GET | `/api/ai/chats/:id/messages` | 会话消息 |
| POST | `/api/ai/chats/:id/messages` | 发消息，**SSE 流式回复**（delta/thinking/result/error） |
| GET | `/api/ai/knowledge` | AI 沉淀节点 + 补充 + 派生边（含审核记录） |
| POST | `/api/ai/knowledge/preview` → `/api/ai/knowledge/apply` | 整合判断预览 → 确认写入（管理员直沉淀） |
| POST | `/api/ai/submissions` · GET `/api/ai/submissions/mine` | 普通用户提交沉淀（表单）· 查自己的提交进度 |
| DELETE | `/api/ai/nodes/:id` · `/api/ai/merges/:id` | 删除 AI 节点 / AI 补充 |
| POST | `/api/ai/paths/generate` | 生成/按反馈调整学习路线（目标或 pathId+feedback） |
| GET | `/api/ai/paths`（官方置顶） | 路线列表（isOfficial 置顶；删除已加权限校验） |
| GET/POST | `/api/admin/paths`；`/:id/official`；`/import` + `/import-status` | 官方路线管理 · 从链接导入（后台任务） |
| GET/POST | `/api/ai/paths`；DELETE `/api/ai/paths/:id` | 已保存路线 列表/保存/删除 |
| GET/PATCH | `/api/admin/users`；PATCH `/api/admin/users/:id` | 用户列表（含所用邀请码）/ 启停、设撤管理员 |
| GET/POST | `/api/admin/invites`；PATCH/DELETE `/api/admin/invites/:id` | 邀请码管理（可重复使用、启停） |
| GET | `/api/admin/submissions`；GET `/api/admin/submissions/:id` | 审核队列列表（?status=）/ 提交详情 |
| POST | `/api/admin/submissions/:id/extract` → `/approve` · `/reject` | 审核时 AI 提取预览 → 通过写入 / 驳回 |
| POST | `/api/admin/nodes/:id/review` | 对已入库 AI 知识点追加审核记录（可多位管理员） |
| GET | `/api/admin/annotations` | 注释审核队列（?status=pending/approved/rejected） |
| POST | `/api/admin/annotations/:id/approve` · `/reject` | 注释通过（全员可见）/ 驳回（需理由） |
| POST/GET | `/api/ai/uploads` · `/api/ai/uploads/mine` | 上传知识（url/text）· 我的上传（状态轮询） |
| GET | `/api/contributions/me` | 贡献汇总（90 天热力图数据 + 总分 + 分类小计） |
| GET | `/api/admin/uploads` | 上传审核队列（含 AI 拆解 items 与专栏清单） |
| POST | `/api/admin/uploads/:id/approve` · `/reject` · `/retry` | 入库（编辑后 items + 专栏归属）/ 驳回 / 重试拆解 |
| GET | `/api/admin/interview-annotations` | 面试题注释状态清单 + 生成任务进度 |
| POST | `/api/admin/interview-annotations/generate` | AI 生成面试题注释（单篇 `{nodeId}` / 补全全部缺失，后台任务） |
| GET | `/api/admin/tiers/status` · POST `/api/admin/tiers/recompute` | 分层选举状态 · 立即重算 |

后端实现：`graph/db.mjs`（MySQL 连接池 + sqlite 风格兼容层）、`graph/llm.mjs`（双协议 SSE 流式 LLM 客户端）、`graph/ai.mjs`（AI 路由与整合/路线/注释 prompt）、`graph/admin.mjs`（管理路由）、`graph/tiers.mjs`（夜间分层选举）、`graph/knowledge.mjs`（bundle 缓存/压缩下发/离线包）、`graph/migrate-sqlite.mjs`（旧 SQLite 一次性迁移）。

## Git

- 远程仓库：https://gitee.com/sediaoopen/llm_learn.git
