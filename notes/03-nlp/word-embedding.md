---
id: word-embedding
title: 词向量（word2vec / GloVe / 腾讯词向量）
category: NLP 算法
layer: L1-算法底层
difficulty: 入门
tags: [词向量, word2vec, GloVe, 相似度召回, 嵌入]
status: learned
links: [bert-series, hanlp-text-analysis, rag-vector-kb]
sources:
  - [word2vec 论文（Mikolov et al., 2013）](https://arxiv.org/abs/1301.3781)
  - [GloVe 项目页（Stanford）](https://nlp.stanford.edu/projects/glove/)
  - [腾讯 AI Lab 词向量](https://ai.tencent.com/ailab/nlp/en/embedding.html)
---

# 词向量（word2vec / GloVe / 腾讯词向量）

> **一句话**：词向量把词映射成稠密向量，且**语义相近则向量相近**（国王−男人+女人≈女王），是深度 NLP 的起点。简历场景：政策匹配链路用**腾讯开源词向量**（800 万+中文词/短语，大规模语料训练）做语义相似度与召回——它与今天的 Embedding 模型（RAG 里的向量化）一脉相承，面试正好讲清这条演化线。

## 1. word2vec（2013，必考）

两种训练结构、一个加速技巧：
- **CBOW**：上下文词预测中心词；**Skip-gram**：中心词预测上下文（小数据高频词 CBOW 好，生僻词/效果 Skip-gram 好）；
- **负采样（Negative Sampling）**：不做全词表 softmax，正例 + 随机抽几个负例做二分类——训练飞快（还有层次 softmax 方案）；
- 本质：**共现规律 → 语义几何结构**，"一个词的含义由它的上下文决定"（分布式假说）。

## 2. GloVe 与 FastText

- **GloVe**：先统计全局共现矩阵，再对共现做矩阵分解——全局统计（word2vec 是滑窗局部）；
- **FastText**：词再拆**子词 n-gram** 向量相加 → 天然处理未登录词（OOV）与形态变化，中文生僻词/错别字场景好用。

## 3. 腾讯 AI Lab 词向量（简历技能点）

- 规模：800 万+中文词与短语（大词表覆盖领域名词）、200 维，基于大规模新闻/网页语料（Directional Skip-gram 考虑词序）；
- 用法（政策匹配链路）：
  - **语义召回**：企业描述与政策条款文本平均池化成句向量，余弦相似度粗排"政策↔企业"匹配；
  - **近义扩展**：查询扩展（"补贴"≈"资助/奖励/扶持"）提升检索召回；
  - **特征**：作为下游模型（BERT 前时代）的输入特征或词表对齐。

## 4. 演化线（面试串讲，高分答法）

```
静态词向量（一个词一个向量）
  word2vec/GloVe/腾讯词向量 → 简单高效，但"苹果手机"和"吃苹果"向量相同（一词多义无解）
        ↓ 上下文相关表示
动态表示（ELMo→BERT）
  同一个词在不同句子里向量不同 → 一词多义解决
        ↓
现代 Embedding 模型（BGE/GTE/text-embedding，对比学习训练）
  直接编码"整段文本"，服务 RAG 语义检索
```

- 一句话总结：从"词级静态几何"到"段落级语义检索"，词向量是 Embedding 思想的原点。

## 5. 高频面试题

1. word2vec 两种模式区别？负采样解决什么？（全词表 softmax 太慢 → 二分类化）
2. 词向量的局限？（静态、一词多义；OOV——FastText 缓解）→ 引出上下文表示
3. 怎么从词向量得到句向量？（平均池化/SIF 加权；现代做法直接用句向量模型）

## 6. 衍生学习

- 对比学习句向量（SimCSE、CoSENT）
- 中文分词与词向量的关系（未登录词问题）
- Embedding 模型训练（BGE 的做法）

## 7. 参考资料

- [Efficient Estimation of Word Representations in Vector Space](https://arxiv.org/abs/1301.3781)
- [GloVe: Global Vectors for Word Representation](https://nlp.stanford.edu/projects/glove/)
- [腾讯 AI Lab 中文词向量](https://ai.tencent.com/ailab/nlp/en/embedding.html)
