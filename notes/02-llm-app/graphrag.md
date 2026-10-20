---
id: graphrag
title: GraphRAG 与知识图谱增强检索
category: 大模型应用
tags: [GraphRAG, 知识图谱, RAG, 多跳推理, Neo4j]
status: learned
links: [rag-vector-kb, hanlp-text-analysis]
sources:
  - [微软 GraphRAG 论文](https://arxiv.org/abs/2404.16130)
  - [microsoft/graphrag（官方实现）](https://github.com/microsoft/graphrag)
  - [Neo4j GraphRAG 文档](https://neo4j.com/labs/genai-ecosystem/)
---

# GraphRAG 与知识图谱增强检索

> **一句话**：GraphRAG = 用 LLM 从语料自动抽取实体与关系构建知识图谱，再基于图结构做检索（实体邻域 + 社区层级摘要），与向量 RAG 互补——**专治向量检索治不了的两大盲区：多跳推理问题和全局汇总问题**。对应简历场景：教育平台「知识图谱辅助检索」的标准化与深化。

## 1. 向量 RAG 的两个盲区（为什么需要图）

| 盲区 | 例子 | 向量检索为什么不行 |
|---|---|---|
| **多跳问题** | "A 公司投资的公司又投资了谁？" | 答案链跨越多个片段，top-k 相似度只召回单跳内容 |
| **全局性问题** | "这 500 份政策文件的主要关切是什么？" | 需要读完全部文档归纳，任何 top-k 片段都只是局部 |

图结构天然表达多跳关系；图的社区摘要天然支持"读一遍摘要而不是全部原文"。

## 2. 微软 GraphRAG 流程（标准范式）

```
离线建库：
文档 → 切块 → LLM 抽取（实体/关系/声明，带类型）→ 知识图谱
     → Leiden 社区检测（把图聚成主题社区）
     → 逐层社区摘要（底层的图社区 → 汇总成上层大社区摘要，map-reduce 式）

在线查询（两条路）：
① Local Search（局部）：从问题实体出发取邻域子图 + 相关原文块 → 生成
   适合："X 与 Y 是什么关系？""某实体的细节"
② Global Search（全局）：问题 → 各顶层社区摘要 map 出要点 → reduce 汇总
   适合："整个语料库的主题/趋势类问题"
```

## 3. 自建知识图谱检索的实践要点（简历场景工程化）

1. **本体先行**：先定义实体类型与关系类型（教育场景：知识点/课程/年级/标准/资源；政策场景：政策/行业/地区/条件/补贴对象），抽取才有约束、图才有质量——本体设计 = 标签体系设计的图版；
2. **抽取**：LLM few-shot 抽取（质量可验收）或微调小模型（UIE/信息抽取笔记的 todo）批量跑，抽完做人机校验；
3. **存图与查询**：Neo4j 存图，检索路径两条——把用户问题转成图查询（文生 Cypher，类比问数中文生 SQL）或先实体链接（问题里的实体对齐到图节点）再取 k 跳邻域子图喂给 LLM；
4. **与向量库互补路由**：简单事实 → 向量 RAG；关系/多跳/汇总 → 图；教育平台的实际做法就是"知识图谱 + 知识库标签化"双通道；
5. **成本控制**（GraphRAG 最大门槛）：全库抽取与摘要 token 开销大——只对核心实体建图、增量更新、摘要分层缓存。

## 4. 何时选 GraphRAG vs 向量 RAG

| 特征 | 建议 |
|---|---|
| 事实片段问答（政策条款原文） | 向量 RAG |
| 关系密集、多跳链路（企业股权、课程标准依赖） | GraphRAG |
| 全库归纳/趋势问题 | GraphRAG（Global） |
| 一般业务 | 先向量 RAG 跑通，遇到多跳 badcase 再叠加图 |

## 5. 高频面试题

1. GraphRAG 与普通 RAG 的本质区别？（结构化关系检索 + 社区摘要归纳 vs 语义相似度片段）
2. 建图成本高怎么办？（核心实体优先、增量更新、抽取用小模型、按需建图）
3. 社区摘要的作用？（把"读全部文档"降为"读分层摘要"，支持全局问题）
4. 怎么评估 GraphRAG 效果？（多跳问题集 + 全局问题集，对比向量 RAG 基线）

## 6. 衍生学习

- LightRAG / HippoRAG 等轻量图检索方案
- 文生 Cypher 与问数的相通性（结合 text2sql 笔记）
- 实体链接与图数据治理

## 7. 参考资料

- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130)
- [microsoft/graphrag](https://github.com/microsoft/graphrag)
- [Neo4j GenAI Ecosystem](https://neo4j.com/labs/genai-ecosystem/)
