# AGENTS.md — 项目协作规范（AI 助手与贡献者必读）

## 第一条：先读 SPEC.md

**修改本项目任何代码之前，必须先读完 [SPEC.md](SPEC.md)。**
它是项目所有者产品需求的唯一事实来源（功能行为规范 + 已拍板的产品决策 + 技术红线）。与 SPEC.md 冲突的实现视为 bug；要改变 SPEC.md 中「已拍板的决策」（§3）必须先征得所有者同意。

## 日常工作规则

1. **技术栈**：后端 NestJS 10 + Prisma + MySQL（TypeScript）；前端 React 18 + Ant Design 5 + Vite（TypeScript）。引入任何新依赖前须征得所有者同意。
2. **验证方式**：后端 `npx nest build`；前端 `npx tsc --noEmit && npx vite build`。不自动运行测试、不执行任何部署。
3. **数据库**：Prisma schema 位于 `backend/prisma/schema.prisma`。新表用 `npx prisma db push` 同步；连接配置在 `backend/.env`（不入库）。任何对数据库结构的改动先征得所有者同意。
4. **功能或行为变更必须同步更新**：SPEC.md 对应章节（必要时加变更记录）+ README.md 的功能说明。
5. **版本发布记录**：每个用户可感知的功能性更新须在 `backend/version.releases.json` 台账追加一条 `{bump, date, changes}`（bump 三档：major 大版本 / minor 新功能 / patch 修复）；纯 UI/样式微调、仅管理员功能、部署与开发运维向改动（deploy.sh、脚本、重构等）**豁免登记**；后端启动时自动写入版本管理，无需手工录入（SPEC §4.23）。
6. **数据分层**：手工笔记与 AI 沉淀的知识都只存 MySQL——手工笔记在管理页「笔记管理」页签编辑（SPEC §4.19；notes/ 文件同步链路已于 2026-10-22 废弃删除）；AI 功能不得自动改写手工笔记的本体内容（「✨ AI 补充」只追加区块）。
7. 文案、注释、文档全部中文；LLM 调用统一走 `backend/src/llm/llm.service.ts`。
8. **多会话并发**：文件内容与预期不符时先重读再改。

## 内容与写作规范

1. **双受众铁律**：学习者既有大模型新手也有老手——任何标签与功能的设计都要同时照顾两类人，自查清单见 [docs/content-style-guide.md](docs/content-style-guide.md) §1。
2. **大白话铁律**：每篇笔记必须有「> **一句话**：…」大白话摘要；术语首次出现必须"翻译"；界面按钮/提示用动宾短语说人话。
3. 笔记元数据字段（原 frontmatter，现为「笔记管理」表单字段）全表与标注判据：见 docs/content-style-guide.md §4–§5。
4. 知识五维模型：见 [docs/knowledge-dimensions-plan.md](docs/knowledge-dimensions-plan.md)。

## 项目速览

- 后端：`cd backend && npm run start:dev` → http://127.0.0.1:8080/api
- 前端：`cd frontend && npm run dev` → http://127.0.0.1:3000
- 结构：`backend/` NestJS 后端 · `frontend/` React 前端（学习笔记存 MySQL，管理页「笔记管理」编辑）
- 功能全貌见 [README.md](README.md)，需求规范见 [SPEC.md](SPEC.md)
