---
id: openai-agent-sdk
title: OpenAI Agent SDK 与智能体工作台
category: Agent 系统
layer: L4-业务应用层
difficulty: 入门
tags: [Agent, OpenAI-Agent-SDK, 智能体平台, Handoff]
status: learned
links: [manus-multi-step-execution, genspark-search-agent, function-call, agent-workflow-skill]
sources:
  - [OpenAI Agents SDK 官方文档](https://openai.github.io/openai-agents-python/)
  - [OpenAI Agents JS（TS 版）](https://openai.github.io/agents-js/)
---

# OpenAI Agent SDK 与智能体工作台

> **一句话**：OpenAI Agent SDK 是官方的多 Agent 编排框架，四个核心原语——**Agent（指令+模型+工具）、Handoff（Agent 间转交）、Guardrail（输入输出护栏）、Tracing（全过程可观测）**，轻量、原生、可换模型。简历场景：2026 年 openclaw（开源个人 AI 助手）带火"人人要有自己的 Agent"后，基于该 SDK 自研智能体工作台，服务公司内部、政府与制造业企业提效。

## 1. 核心概念

| 原语 | 作用 | 类比自己项目里的东西 |
|---|---|---|
| Agent | 模型 + 指令 + 工具集的最小单元 | 平台里配置的一个个"智能体应用" |
| Tool | Function Call 工具（Python 函数自动转 schema） | 平台工具层封装的检索/查数/生成类工具 |
| Handoff | 一个 Agent 把对话转交给更专业的 Agent | 智能客服 → 政策专精 Agent 的路由 |
| Guardrail | 前置/后置校验（敏感词、格式、合规） | 政务场景的内容安全与格式校验 |
| Tracing | 每步调用链路可视化追踪 | 平台的运行日志与调试面板 |

一个最小可用结构（伪代码）：

```python
from agents import Agent, Runner

policy_agent = Agent(
    name="政策匹配助手",
    instructions="你是政策专家，只依据检索到的政策材料回答……",  # 提示词工程的落点
    tools=[search_policy_kb, match_enterprise],          # Function Call 的落点
)
result = await Runner.run(policy_agent, "苏州智能制造企业能申报什么补贴？")
```

## 2. 为什么选它做工作台底座（选型答法）

- **官方原生 + 极简抽象**：没有重框架的概念税（对比 LangChain 的层层封装），核心逻辑就是 Agent 循环（呼应 Manus「LLM in a while loop」、Genspark「Less Control, More Tools」——两家头部产品的共识：薄编排、厚工具）；
- **Handoff 原生支持多 Agent 分工**：主 Agent 做意图路由，垂类 Agent（政策/问数/客服）各带各的工具与知识库；
- **Tracing 内置**：政务交付必须可审计，每次运行的工具调用、token 消耗、中间输出全链路留痕；
- **不锁模型**：可接 OpenAI，也支持接入自部署的 vLLM 服务（Qwen/GLM），内网政务环境友好——这正是简历里"内网模型部署 + 平台模型管理配置"的组合拳。

## 3. 智能体工作台的产品化要点（简历场景展开）

- **面向不同角色的抽象**：业务人员（选模板/改提示词/配知识库，零代码）、开发者（SDK 开发自定义工具/Skill）、管理员（模型路由/配额/审计）；
- **Skill 封装**：把"提示词 + 工具 + 固定流程 + 知识库引用"打包成可复用资产（详见工作流编排笔记）；
- **多模型配置**：同一 Agent 允许配置不同底座模型并按成本/时延路由（分类走小模型、推理走大模型，呼应 Genspark MoA 思想）；
- **评测与回归**：Agent 上线前跑固定场景集（准确率/工具选择正确率），防"改一处坏一片"。

## 4. 高频面试题

1. Agent SDK 和 LangChain/LangGraph 怎么选？（轻量原生 vs 生态组件全；需要精细状态机用 LangGraph，快速多 Agent 分工 + 官方维护用 Agents SDK）
2. Handoff 和工具调用的区别？（Handoff 是"换人接手对话主权"，工具是"叫人帮忙干一件事然后拿结果回来"）
3. 多 Agent 系统怎么防失控？（Guardrail、每步留痕 Tracing、工具最小权限、循环深度/预算上限）

## 5. 衍生学习

- openclaw 开源项目架构（个人 AI 助手形态）
- LangGraph 状态机式编排对比
- Agent 评测（工具选择正确率、任务完成率）

## 6. 参考资料

- [OpenAI Agents SDK（Python）](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents JS](https://openai.github.io/agents-js/)
