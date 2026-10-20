---
id: rag-vector-kb
title: RAG 与向量知识库
category: 大模型应用
tags: [RAG, 向量检索, Milvus, Embedding, 知识库]
status: learned
links: [prompt-engineering, text2sql-chatbi, hallucination-mitigation]
sources:
  - [RAG 原始论文（Lewis et al., 2020）](https://arxiv.org/abs/2005.11401)
  - [Milvus 官方文档](https://milvus.io/docs)
  - [Anthropic: Contextual Retrieval（上下文增强检索）](https://www.anthropic.com/news/contextual-retrieval)
---

# RAG 与向量知识库

> **一句话**：RAG（Retrieval-Augmented Generation）= 先检索后生成——把私有知识/最新知识切块向量化存进向量库（如 Milvus），提问时检索最相关的片段塞进提示词，让模型**基于给定材料**回答。解决大模型三大痛点：知识过期、私有知识缺失、幻觉。

## 1. 标准链路（五段式）

```
① 离线建库：文档解析(PDF/Word/网页) → 清洗 → 切分(Chunking) → Embedding 向量化 → 写入向量库(带元数据)
② 在线检索：用户问题 → (可选:查询改写) → Embedding → 向量相似度检索 Top-K（+元数据过滤）
③ 重排：Rerank 模型对候选精排，取 Top-N
④ 生成：把片段拼进提示词，约束"只依据材料回答 + 标注引用"
⑤ 反馈：点赞点踩回流，优化切分/检索策略
```

## 2. 向量库与检索基础

- **Embedding**：文本 → 高维稠密向量（如 1024 维），语义相近则向量相近；相似度用内积/余弦（用 BGE、m3e、OpenAI text-embedding 等模型，政务/教育场景中文 BGE 系效果好）；
- **ANN 索引**：向量库用近似最近邻索引（HNSW：图索引精度高内存大；IVF：聚类分桶快但召回略低）换检索速度；
- **Milvus**（简历技能）：开源向量数据库，支持 Collection/Partition、标量字段过滤（`industry == "制造"` 这类**元数据过滤**，正是问数与政务场景的杀手锏）、多副本与分布式；
- **混合检索**：向量（语义）+ BM25（关键词/术语/编号）+ 结构化过滤，三路召回合并——政策文号、专有名词靠纯向量容易漏。

## 3. RAG 效果优化清单（面试核心弹药）

| 环节 | 常见问题 | 优化手段 |
|---|---|---|
| 切分 | 切太碎丢上下文/太大检索不精 | 按标题层级切、512~1024 token、chunk 重叠 10~20%；Contextual Retrieval：给每个块用 LLM 生成一段"它属于哪篇/哪章"的上下文前缀再入库，检索失败率显著下降（Anthropic 实测） |
| 检索 | 召回不准 | 查询改写（指代消解、口语→术语）、HyDE（先生成假设答案再检索）、混合检索 |
| 过滤 | 跨范围命中 | 元数据过滤（部门/年份/密级/适用对象），简历中「知识库标签化」即此 |
| 生成 | 检索对了答错 | 提示词强约束引用、片段编号溯源、答案与引用对齐校验 |
| 结构化知识 | 多跳关系 | 知识图谱辅助检索（GraphRAG）：实体关系抽取建图，多跳查询走图、事实查询走向量 |
| 评测 | 不知道好不好 | 构造评测集：检索命中率（Recall@K）+ 生成质量（忠实度/相关性），LLM-as-Judge 打分 |

## 4. 简历场景对齐

- 教育平台「知识图谱与知识库标签化辅助检索」：标签 = 元数据过滤维度（学科/学段/资源类型），知识图谱承接课程标准的多跳关系；
- 风云平台「统一管理数据集与向量知识库」：知识库作为平台级资产，Collection 权限隔离 + 切分策略可配置；
- 典型追问：**为什么用 RAG 而不是微调？**——知识频繁更新/需要溯源/数据量大且结构复杂 → RAG；要改变模型行为风格/领域术语理解 → 微调；两者常组合（微调让模型更会"用"检索材料）。详见微调笔记的决策表。

## 5. 高频面试题

1. RAG 与微调怎么选？（见上，决策表在 llm-finetuning）
2. 检索召回率低怎么排查？（先分段评测：切分→召回→重排→生成，定位瓶颈再下药）
3. 向量库选型？（Milvus 分布式/功能全；PGVector 轻量；ES 8 支持向量；看数据量与运维成本）
4. chunk 大小怎么定？（实验驱动：512/1024 对比 + overlap，评测集说话）

## 6. 衍生学习

- GraphRAG（微软）与知识图谱融合检索
- Rerank 模型（BGE-reranker、Cohere Rerank）
- Agentic RAG：让 Agent 决定检索什么、检索几轮

## 7. 参考资料

- [RAG 原始论文](https://arxiv.org/abs/2005.11401)
- [Milvus 官方文档](https://milvus.io/docs)
- [Anthropic: Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
