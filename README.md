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
├── notes/                 # 全部学习笔记（一个知识点 = 一个 md 文件）
│   └── 01-agent/          # 按主题分类的目录（编号仅用于排序，分类以 frontmatter 为准）
├── graph/                 # 知识图谱前端项目（原生 JS + ECharts，零依赖构建）
│   ├── index.html         # 浏览器直接打开即可使用
│   ├── build.mjs          # 构建脚本：扫描 notes/ 生成图谱数据
│   ├── data/knowledge.js  # 构建产物（随仓库提交，双击 index.html 即可看）
│   └── js/ css/           # 图谱渲染代码与样式
├── SPEC.md                # 产品需求规范（必读）
├── AGENTS.md              # 协作规范（AI 助手与贡献者必读）
├── README.md
└── .gitignore
```

## 如何新增一个学习点（三步）

1. **写笔记**：在 `notes/<分类目录>/` 下新建 `xxx.md`，文件头带上 frontmatter（模板见下）。
   - 学完了 → `status: learned`；只是先立个"衍生学习/待学"的坑 → `status: todo`（图谱上会以半透明虚线节点显示）。
2. **构建图谱**：`cd graph && npm run build`（等价于 `node build.mjs`）。
3. **查看**：浏览器打开 `graph/index.html`，点击节点学习；节点间连线由 `links` 字段生成。

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

- 启动服务：`cd graph && npm start`，访问 http://127.0.0.1:8080（需 Node ≥ 22.13）
  - **注册/登录**后可为每个知识点标注学习程度（未学习/了解/熟悉/掌握），节点外圈按程度着色，顶栏统计已学比例
  - 学习进度存本地 SQLite（`graph/data/app.db`，不入库），多用户进度相互独立
- 不启动服务时也可直接双击 `graph/index.html` 看图谱（离线只读模式，不能登录/标注；ECharts/marked 走 CDN 需联网）
- 交互：节点可拖拽、滚轮缩放、搜索过滤；**标签条可多选筛选**（选中状态保留，与搜索叠加）；**力导向 ↔ 分层**两种视图切换（分层视图 L1 算法底层在底、L4 业务应用层在顶，纵向=层次、颜色=领域分类）
- 点击节点 → 右侧面板显示笔记全文、所属层次与分类、学习程度标注、关联知识点（可继续点击跳转）与参考资料；右上角 ⛶ 可全屏放大阅读（A−/A＋ 字号）
- `status: todo` 的节点在图上呈半透明虚线边框，代表「衍生学习」待办，学完后改状态并重新构建即可

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

### 相关 API 一览（均需 Bearer 登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/llm/models`；PUT/DELETE `/api/llm/models/:id` | 模型增删改查（key 脱敏） |
| PUT | `/api/llm/models/:id/global` · POST `/api/llm/models/:id/test` | 设全局默认 · 测连通 |
| GET/POST | `/api/ai/chats`；PATCH/DELETE `/api/ai/chats/:id` | 共享会话管理 |
| GET | `/api/ai/chats/:id/messages` | 会话消息 |
| POST | `/api/ai/chats/:id/messages` | 发消息，**SSE 流式回复**（delta/thinking/result/error） |
| GET | `/api/ai/knowledge` | AI 沉淀节点 + 补充 + 派生边 |
| POST | `/api/ai/knowledge/preview` → `/api/ai/knowledge/apply` | 整合判断预览 → 确认写入 |
| DELETE | `/api/ai/nodes/:id` · `/api/ai/merges/:id` | 删除 AI 节点 / AI 补充 |

后端实现：`graph/llm.mjs`（双协议 SSE 流式 LLM 客户端）、`graph/ai.mjs`（全部 AI 路由与整合 prompt）。

## Git

- 远程仓库：https://gitee.com/sediaoopen/llm_learn.git
