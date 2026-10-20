---
id: multi-agent-patterns
title: 多 Agent 协作模式
category: Agent 系统
layer: L3-应用工程层
tags: [Multi-Agent, 编排, 路由, 辩论, MoA, LangGraph]
status: todo
links: [openai-agent-sdk, genspark-search-agent, agent-workflow-skill]
sources:
  - [Mixture-of-Agents 论文（Genspark 思想源头）](https://arxiv.org/abs/2406.04692)
  - [AutoGen 论文（微软多智能体框架）](https://arxiv.org/abs/2308.08155)
  - [LangGraph 文档](https://langchain-ai.github.io/langgraph/)
---

# 多 Agent 协作模式（待学习）

> 一句话：多 Agent 不是"人多力量大"，而是四种结构化模式的选型题——**路由分发**（主从 Handoff）、**并行扇出**（MoA/Map-Reduce）、**流水线**（工序接力）、**辩论**（互相批改收敛），外加图状态机（LangGraph）作为统一表达；组合起来就是 Genspark 的 MoA 与 Manus 的主/子 Agent。

## 是什么 / 为什么值得学

- **路由分发**：意图识别 → 垂类 Agent（客服/问数/政策），平台标配；
- **并行扇出**：多模型/多视角同时作答再聚合（MoA 论文的 proposer-aggregator 结构，Genspark 工程化）；
- **流水线**：检索 Agent → 起草 Agent → 校对 Agent，按工序切上下文；
- **辩论**：多 Agent 互相质疑修正，提升事实性与推理质量（代价：token 成本×N）；
- 框架光谱：OpenAI Agent SDK（轻量 Handoff）→ LangGraph（显式状态机/循环图）→ AutoGen（对话式协作）；A2A（Agent 间通信协议）是更新的标准化方向。

## 学习路径

1. 精读 MoA 论文的分层聚合结构与消融实验；
2. 用 Agent SDK 的 Handoff 实现路由模式；再手写一个"两 Agent 辩论 + 裁判"原型；
3. 总结选型表：任务可分解性/成本预算/时延要求 → 模式选择。

## 关键问题（学完应能回答）

- 多 Agent 一定比单 Agent 好吗？（NO：错误传播与成本，简单任务单 Agent + 好工具更优——Genspark/Manus 共识）
- 辩论模式为什么有效？（多样化采样 + 批判性交叉验证，类似 Self-Consistency 的强化版）

## 参考资料

- [Mixture-of-Agents](https://arxiv.org/abs/2406.04692)
- [AutoGen](https://arxiv.org/abs/2308.08155)
- [LangGraph](https://langchain-ai.github.io/langgraph/)
