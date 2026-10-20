---
id: contrastive-embedding
title: 对比学习句向量（SimCSE → BGE）
category: NLP 算法
layer: L1-算法底层
difficulty: 深入
tags: [SimCSE, 对比学习, 句向量, BGE, Embedding]
status: todo
links: [word-embedding, bert-series, rag-vector-kb]
sources:
  - [SimCSE 论文](https://arxiv.org/abs/2104.08821)
  - [BGE 论文（C-Pack）](https://arxiv.org/abs/2309.07597)
---

# 对比学习句向量：SimCSE → BGE（待学习）

> 一句话：怎么把 BERT 变成好的句向量模型——SimCSE 用"自己预测自己"的无监督对比学习拉齐语义空间，BGE 用大规模弱监督对 + 指令微调 + 重排蒸馏做出中文检索最优的 Embedding 系列，是 RAG 向量检索的发动机原理。

## 是什么 / 为什么值得学

- 痛点：原生 BERT 的句向量质量差（各向异性，语义空间扭曲），直接平均池化余弦相似度效果差；
- **SimCSE**：无监督版（同一句子两次 dropout 前向作为正对，其他句为负对）——妙在"dropout 当数据增强"；有监督版用 NLI 蕴含对；
- **BGE（智源）**：中文检索 Embedding 的工程范本——大规模配对数据预训练 → 指令微调 → 用 reranker 蒸馏对齐，配负例挖掘（难负例）；
- 与 RAG 的直接关系：Embedding 模型质量 = 检索上限；微调自己的 Embedding（领域难负例）是 RAG 调优的进阶手段。

## 学习路径

1. 精读 SimCSE 的正负对构造与对齐/均匀性分析；
2. 在 MTEB/CMTEB 上对比 BGE 与通用模型的中文检索分；
3. 进阶实操：用领域数据（政策-企业配对 + 难负例）微调 BGE，评测召回率提升。

## 关键问题（学完应能回答）

- 为什么需要"难负例"？（全是简单负例时对比任务太容易，学不到细粒度区分）
- Embedding 模型微调与 LLM 微调的差异？（目标：检索排序而非生成；损失：对比损失 InfoNCE）

## 参考资料

- [SimCSE](https://arxiv.org/abs/2104.08821)
- [C-Pack: BGE](https://arxiv.org/abs/2309.07597)
