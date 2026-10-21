# AGENTS.md — 项目协作规范（AI 助手与贡献者必读）

## 第一条：先读 SPEC.md

**修改本项目任何代码之前，必须先读完 [SPEC.md](SPEC.md)。**
它是项目所有者产品需求的唯一事实来源（功能行为规范 + 已拍板的产品决策 + 技术红线）。与 SPEC.md 冲突的实现视为 bug；要改变 SPEC.md 中「已拍板的决策」（§3）必须先征得所有者同意。

## 日常工作规则

1. **依赖红线**：后端唯一 npm 运行时依赖为 `mysql2`（2026-10-20 经所有者同意引入），其余只用 Node ≥ 22 内置模块；前端原生 JS + CDN。引入任何其他依赖、或改动 SPEC.md §5 技术红线前，必须征得所有者同意。
2. **验证方式**：改动后做本地验证即可——`node --check`（改动的 js/mjs）+ `npm run build`（改动 notes 或同步逻辑时；需 MySQL 可达）。不自动运行测试、不执行任何部署（deploy.sh / 上传 / systemctl 等），部署由所有者手动完成。
3. **数据库（MySQL）**：连接配置 `graph/config/db.json`（空值占位，提交 git）+ `graph/config/db.local.json`（真实值，gitignore 不提交）；`DB_ENV=dev|prod` 选节，`DB_*` 环境变量优先。新表一律 `CREATE TABLE IF NOT EXISTS` 随启动/构建自动建（无迁移机制）；存量表加列用 information_schema 检测的幂等 ALTER；其他结构性改动（手工写数据、DROP 等）先征得所有者同意。旧 SQLite 数据用 `npm run migrate-sqlite` 一次性迁入（由所有者手动执行）。
4. **功能或行为变更必须同步更新**：SPEC.md 对应章节（必要时加变更记录）+ README.md 的 API/功能说明。
5. **数据分层**：手工笔记只存在于 `notes/*.md`（创作源头，`npm run build` 单向同步入 MySQL）；AI 沉淀/注释等动态知识只存 MySQL，**任何功能都不得自动改写 notes/ 下的文件**。
6. 文案、注释、文档全部中文；拼 HTML 过 `esc()`；LLM 调用统一走 `graph/llm.mjs`。
7. **多会话并发**：本仓库常有多个 AI 会话同时工作——文件内容与预期不符时先重读再改（勿凭记忆覆盖他人改动）；不要停止/重启不是自己启动的服务进程。

## 内容与写作规范（写笔记、改界面文案前必读）

1. **双受众铁律**：学习者既有大模型新手也有老手——任何标签与功能的设计都要同时照顾两类人（新手有入口与引导、老手有深度与效率），自查清单见 [docs/content-style-guide.md](docs/content-style-guide.md) §1。
2. **大白话铁律**：每篇笔记必须有「> **一句话**：…」大白话摘要（同步时提取进 tooltip/面板，缺失会告警）；术语首次出现必须"翻译"；界面按钮/提示用动宾短语说人话；**新控件必须带大白话 hover 提示，并同步更新「❓ 使用说明」弹窗**。
3. frontmatter 字段全表与 difficulty / layer / path 的标注判据：见该文档 §4–§5；`npm run build` 告警必须清零。
4. 知识五维模型（category 领域 / layer 层次 / status+level 学习状态 / path 路线 / difficulty 难度）：见 [docs/knowledge-dimensions-plan.md](docs/knowledge-dimensions-plan.md)。

## 项目速览

- 启动：`cd graph && npm start` → http://127.0.0.1:8080（需 Node ≥ 22 + MySQL 可达，首次先 `npm install`）
- 同步：`cd graph && npm run build`（notes/*.md 增量同步进 MySQL，页面从库中 gzip 压缩下发）
- 结构：`notes/` 学习笔记（frontmatter 元信息）· `graph/` 前端 + 后端（server.mjs 分发；db/ai/admin/tiers/knowledge 为能力模块，llm.mjs 为 LLM 客户端，boot.js 为前端取数引导）
- 功能全貌与 API 一览见 [README.md](README.md)，需求规范见 [SPEC.md](SPEC.md)
