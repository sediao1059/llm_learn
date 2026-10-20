---
id: agentic-rag
title: Agentic RAG
category: 大模型应用
tags: [RAG, Agent, 多轮检索, Self-RAG]
status: todo
links: [rag-vector-kb, agent-paradigms, rerank-models]
sources:
  - [Self-RAG 论文](https://arxiv.org/abs/2310.11511)
  - [CRAG（纠错式检索）论文](https://arxiv.org/abs/2401.15884)
  - [LlamaIndex Agentic RAG 文档](https://docs.llamaindex.ai/en/stable/understanding/agent/)
---

# Agentic RAG（待学习）

> 一句话：把"检索几次、检索什么、够了没有"的决策权从固定流程交给 Agent——由 LLM 在循环里自主决定是否检索、改写查询、换数据源、多轮迭代直到信息足够再作答。

## 是什么 / 为什么值得学

- 传统 RAG 是"一次检索一次生成"的固定管道：查不到就硬答（幻觉温床）；
- Agentic RAG 让模型自己判断：需不需要检索？换什么关键词？结果相关吗？要不要再查一轮？（把 RAG 从管道变成 Agent 的一个工具）；
- 代表工作：Self-RAG（模型自省是否需要检索、自我批判检索质量）、CRAG（检索质量评估 + 失败纠错）。

## 学习路径

1. 复习 RAG 五段链路（已学节点）→ 找出"固定管道"的三处决策点；
2. 精读 Self-RAG：反思 token 机制怎么训出来；
3. 用 OpenAI Agent SDK 把 Milvus 检索封装成工具，手搭一个两轮迭代问答原型；
4. 对比固定管道与 Agentic 的准确率/时延/成本。

## 关键问题（学完应能回答）

- 什么时候 Agentic RAG 反而不划算？（时延与 token 成本、简单事实查询）
- 怎么防止 Agent 无限检索？（最大轮数、信息充分性自评、预算控制）

## 参考资料

- [Self-RAG](https://arxiv.org/abs/2310.11511)
- [Corrective RAG (CRAG)](https://arxiv.org/abs/2401.15884)
- [LlamaIndex Agentic RAG](https://docs.llamaindex.ai/en/stable/understanding/agent/)
