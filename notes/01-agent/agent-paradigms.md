---
id: agent-paradigms
title: Agent 范式对比（ReAct / Plan-and-Execute / Reflexion）
category: Agent 系统
layer: L3-应用工程层
tags: [ReAct, Plan-and-Execute, Reflexion, Agent范式]
status: todo
links: [manus-multi-step-execution, function-call, openai-agent-sdk]
sources:
  - [ReAct 论文](https://arxiv.org/abs/2210.03629)
  - [Reflexion 论文](https://arxiv.org/abs/2303.11366)
  - [Plan-and-Solve 论文](https://arxiv.org/abs/2305.04091)
---

# Agent 范式对比：ReAct / Plan-and-Execute / Reflexion（待学习）

> 一句话：Agent 循环的经典三范式——ReAct（边想边做）、Plan-and-Execute（先规划后执行）、Reflexion（失败后自我反思再试），现代产品（Manus 的 todo.md、Agent SDK 的循环）都是这三者的工程混合体。

## 是什么 / 为什么值得学

- **ReAct**：Thought → Action → Observation 交替，边推理边行动，灵活但容易跑偏（无全局计划）；
- **Plan-and-Execute**：先出完整计划再逐步执行（Manus 的 todo.md 正是此范式的文件化），方向稳但计划僵硬，需要重规划机制；
- **Reflexion**：失败后生成语言化的"自我反思"存入记忆，下一轮带着教训重试（对应 Manus"保留错误"的理论依据）；
- 现代实践 = Plan(宏观) + ReAct(微观) + Reflexion(纠错) 的组合拳。

## 学习路径

1. 精读三篇论文的核心算法框图（各半小时）；
2. 用 OpenAI Agent SDK 分别实现三种循环跑同一个任务（如"查三个数据源对比政策补贴"），对比成功率/步数/成本；
3. 归纳：什么任务用哪种？（探索型 ReAct；确定性交付型 Plan；高错误成本型加 Reflexion）。

## 关键问题（学完应能回答）

- ReAct 的 Thought 有什么用？（显式推理链提升工具选择与参数质量，也便于调试）
- 什么时候重规划？（观察与预期偏差、计划步骤失败、用户补充约束）

## 参考资料

- [ReAct](https://arxiv.org/abs/2210.03629)
- [Reflexion](https://arxiv.org/abs/2303.11366)
- [Plan-and-Solve](https://arxiv.org/abs/2305.04091)
