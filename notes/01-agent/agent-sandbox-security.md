---
id: agent-sandbox-security
title: Agent 沙箱与安全
category: Agent 系统
tags: [沙箱, 安全, 提示注入, 权限, 隔离]
status: todo
links: [manus-multi-step-execution, function-call]
sources:
  - [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/)
  - [Simon Willison：提示注入系列博客](https://simonwillison.net/tags/prompt-injection/)
  - [Anthropic：Agent 安全工程实践（Building effective agents 相关讨论）](https://www.anthropic.com/research/building-effective-agents)
---

# Agent 沙箱与安全（待学习）

> 一句话：Agent 拿到执行权（shell/浏览器/工具）后，安全模型从"说错话"升级为"做错事"——沙箱隔离（VM/容器/WASM 选型）、最小权限、提示注入防御、人工确认关卡，是给 Agent 上线的必答题（Manus 给独立 VM 正是为了这个）。

## 是什么 / 为什么值得学

- **威胁面**：提示注入（网页/文档内容里藏指令劫持 Agent）、越权工具调用、数据外泄（Agent 把内网数据发外网）、供应链（恶意依赖）；
- **沙箱选型**：VM（隔离最重、快照回滚，Manus 路线）vs 容器（轻量、镜像生态，K8s 友好）vs WASM（毫秒级冷启动、能力受限）——按"信任级别 × 性能要求"选；
- **纵深防御**：网络白名单（出网管控）、文件系统隔离、工具白名单与分级授权（读类自动、写类确认、删类人工）、审计日志全留痕；
- OWASP LLM Top 10 是面试与方案评审的通用语言。

## 学习路径

1. 通读 OWASP LLM Top 10，映射到自己平台的每一项（哪些已有、哪些缺）；
2. 设计政务场景的 Agent 权限矩阵：工具 × 角色 × 数据级别的批准策略；
3. 做一个提示注入攻防实验：在知识库文档里埋"忽略之前指令"类载荷，验证防御措施。

## 关键问题（学完应能回答）

- 为什么提示注入没有"彻底解法"？（模型无法根本区分"指令"与"数据"——只能纵深防御+最小权限+监控）
- 内网政务 Agent 的出网策略怎么设计？（域名白名单、代理审计、敏感数据 DLP 检查）

## 参考资料

- [OWASP Top 10 for LLM Apps](https://genai.owasp.org/llm-top-10/)
- [Simon Willison: Prompt Injection](https://simonwillison.net/tags/prompt-injection/)
- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
