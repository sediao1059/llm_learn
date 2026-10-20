---
id: function-call
title: Function Call 与工具调用
category: 大模型应用
tags: [Function-Call, Tool-Use, Agent, JSON]
status: learned
links: [prompt-engineering, openai-agent-sdk, hallucination-mitigation]
sources:
  - [OpenAI Function Calling 官方文档](https://platform.openai.com/docs/guides/function-calling)
  - [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)
  - [ReAct 论文（工具调用的文本推理前身）](https://arxiv.org/abs/2210.03629)
---

# Function Call 与工具调用

> **一句话**：Function Call 让模型不再"只会说话"，而是能输出**结构化的工具调用意图**（函数名 + JSON 参数），由应用程序执行后把结果回传，模型再基于真实结果作答——这是 Agent 的一切基础，也是抑制幻觉（把事实问题交给工具）的关键手段。

## 1. 工作流程（本质是个循环）

```
① 开发者：用 JSON Schema 声明工具
   { name: "query_policy", description: "按企业条件检索政策",
     parameters: { region: string, industry: string, size: enum } }

② 模型：判断需要工具 → 输出结构化调用意图（不是自然语言）
   query_policy({ region: "苏州", industry: "智能制造" })

③ 应用：真正执行函数（查库/调 API/跑计算）

④ 应用：把执行结果（或错误信息）回传给模型

⑤ 模型：基于真实结果生成最终回答（可能继续②，多轮调用）
```

要点：
- **模型不执行任何东西**，它只产生"调用意图"，执行权在应用侧——这是安全边界；
- 工具的 `description` 和参数描述**就是给模型看的提示词**，写得越清楚选得越准；
- 支持一次返回多个调用（并行工具调用），也支持强制指定必调某个工具（tool_choice）。

## 2. 与 ReAct 的关系

- ReAct（2022）：用文本格式模拟「Reasoning + Acting」，`Thought: ... Action: search[...]`，靠提示词约定、正则解析——容易格式出错；
- 原生 Function Call：模型经过专门训练，直接输出结构化 JSON，稳定且是 API 一等公民。两者思想同源：**推理决定行动，观察结果再推理**。

## 3. 工程实践要点（简历场景：辅助开发工具类并通过 Function Call 调用减少幻觉）

| 实践 | 说明 |
|---|---|
| 参数强校验 | 模型输出的参数先过 Schema 校验，不合法直接回传错误让模型重试 |
| 错误也要回传 | 工具执行失败把报错返回模型，它会换参数或换路径（呼应 Manus「保留错误」） |
| 工具粒度 | 一个工具做一件事、命名动词化、参数少而明确；工具过多反而降低选择准确率 |
| 结果截断 | 工具返回大结果要摘要/分页，避免撑爆上下文 |
| 幻觉抑制 | 事实类问题（政策条款、库存、订单状态）强制走工具，禁止模型凭记忆回答 |
| 幂等与权限 | 写操作工具要幂等设计 + 最小权限 + 确认环节 |

## 4. 高频面试题

1. Function Call 的原理？模型真的执行了函数吗？（没有，模型输出结构化意图，应用执行）
2. 模型选错工具/参数错了怎么办？（描述优化、参数校验回传重试、tool_choice 约束、few-shot 示例）
3. Function Call 和 MCP 的关系？（MCP 是工具的标准化协议/生态——统一工具接入方式；Function Call 是模型侧能力）
4. 如何减少多工具场景下的误调用？（工具数量控制、分组按需提供、命名与描述工程化）

## 5. 衍生学习

- MCP（Model Context Protocol）工具协议生态
- 并行工具调用与多工具编排
- 结构化输出（Structured Outputs）与 JSON Schema 约束解码

## 6. 参考资料

- [OpenAI Function Calling 官方文档](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
