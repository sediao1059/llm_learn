---
id: rerank-models
title: 重排模型（Rerank）
category: 大模型应用
tags: [Rerank, 检索优化, ColBERT, BGE]
status: todo
links: [rag-vector-kb, agentic-rag]
sources:
  - [ColBERT 论文（迟交互式排序）](https://arxiv.org/abs/2004.12832)
  - [BAAI BGE-reranker（HuggingFace）](https://huggingface.co/BAAI/bge-reranker-large)
  - [Cohere Rerank 文档](https://docs.cohere.com/docs/rerank-overview)
---

# 重排模型 Rerank（待学习）

> 一句话：召回（向量检索快而粗）之后、生成之前，用一个更精细的交叉编码器对 Top-50 候选重排序取 Top-5——"快召回 + 精重排"两级流水线，是 RAG 效果提升性价比最高的一环。

## 是什么 / 为什么值得学

- 双塔（Bi-Encoder，Embedding 检索）：查询和文档分别编码，离线建库快，但两者从未"见过面"，精度有天花板；
- 交叉编码（Cross-Encoder，Rerank）：查询+文档拼一起进模型，逐对精算相关分，精度高但必须在线逐对计算——只适合小候选集；
- 迟交互（ColBERT 类）：token 级向量存下来、查询时做 MaxSim，精度与速度折中。

## 学习路径

1. 手推三种架构的差异（双塔/交叉/迟交互），理解"为什么不能全库 Cross-Encoder"；
2. 在现有 RAG 链路里加 BGE-reranker：Top-20 → 重排 → Top-5，评测 Recall@5 变化；
3. 了解 reranker 与 LLM 排序（listwise LLM rerank）的用法与成本差异。

## 关键问题（学完应能回答）

- Rerank 为什么能提升忠实度？（更相关的上下文 → 更少编造）
- 加了 Rerank 时延增加多少？怎么权衡？（并行打分、候选数控制）

## 参考资料

- [ColBERT](https://arxiv.org/abs/2004.12832)
- [BGE-reranker-large](https://huggingface.co/BAAI/bge-reranker-large)
- [Cohere Rerank](https://docs.cohere.com/docs/rerank-overview)
