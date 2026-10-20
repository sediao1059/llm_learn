---
id: bert-series
title: BERT 原理与文本分类
category: NLP 算法
layer: L1-算法底层
path: 1.4
difficulty: 进阶
tags: [BERT, Transformer, 文本分类, MLM, 微调]
status: learned
links: [word-embedding, llm-finetuning, hanlp-text-analysis]
sources:
  - [BERT 原始论文（Devlin et al., 2018）](https://arxiv.org/abs/1810.04805)
  - [RoBERTa 论文](https://arxiv.org/abs/1907.11692)
  - [HuggingFace Transformers 文档](https://huggingface.co/docs/transformers)
---

# BERT 原理与文本分类

> **一句话**：BERT = Transformer 的 **Encoder** 堆叠 + **双向**预训练（完形填空 MLM），预训练完再在下游任务上微调，是判别式 NLP 任务（分类/抽取/匹配）的经典基座。简历场景：政策匹配核心链路中用 **BERT 分类器**做政策文本分类——今天在 LLM 时代它依然是低成本高精度的垂类打分器。

## 1. 核心原理（面试必背）

- **结构**：多层 Transformer Encoder（Base 12 层/110M，Large 24 层/340M），双向注意力——每个 token 能同时看到左右文；
- **预训练两个任务**：
  - **MLM（Masked Language Model）**：随机遮 15% 的 token 让模型还原（完形填空）——学到双向上下文表示；
  - **NSP（Next Sentence Prediction）**：判断两句是否相邻（RoBERTa 证明其没用并去掉）；
- **输入表示**：token embedding + position embedding + segment embedding；句首插 `[CLS]`；
- **GPT 是_decoder（从左到右生成），BERT 是 encoder（双向理解）**——一个擅长写，一个擅长"读懂"，这是 LLM 与 BERT 的分工根源。

## 2. 下游任务微调（政策分类实战）

```
[CLS] 政策文本...  →  取 [CLS] 的输出向量  →  接一个线性分类头  →  softmax 多分类
```

- 微调三件套：分类头随机初始化、**小学习率**（2e-5 ~ 5e-5，比预训练小几个量级）、1~4 个 epoch（过拟合很快）；
- 数据量：每类几百条即可有不错效果（这正是它对 LLM 的成本优势：推理毫秒级、单卡可跑几十 QPS）；
- 实用细节：类别不均衡用加权损失/过采样；长文本滑窗或关键段抽取；`hfl/chinese-roberta-wwm-ext` 是中文任务常用基座（全词遮蔽）。

## 3. 家族演进（一句话版）

| 模型 | 一句话改进 |
|---|---|
| RoBERTa | 去 NSP、更大 batch 更多数据、动态 masking |
| ALBERT | 参数共享瘦身 |
| DistilBERT | 蒸馏小模型，快 60% |
| MacBERT / ERNIE（百度） | 中文语料与 masking 策略优化 |
| DeBERTa | 解耦注意力，效果更强 |

## 4. BERT vs LLM（垂类任务怎么选，高频题）

| 维度 | BERT 微调 | LLM（提示/微调） |
|---|---|---|
| 分类/抽取精度 | 小数据下稳、高 | 数据少时靠提示，LoRA 后可比 |
| 推理成本 | 毫秒级、单卡高并发 | 秒级、显存高 |
| 泛化/生成/指令 | 不行 | 行 |
| 可解释上线周期 | 需训练+部署 | 提示词即可上线 |

- 简历链路的正确姿势（2021→2024 演进）：HanLP 抽要素 + BERT 分类器 → 2024 年用 GLM-4-9B LoRA 微调替代升级，**两者并存**：高并发打分用小模型，复杂理解用 LLM——面试讲清"为什么这么演进"就是加分项。

## 5. 高频面试题

1. 为什么 BERT 用 MLM 而不是 GPT 式自回归？（要双向理解；代价是不能直接做生成）
2. [CLS] 为什么能代表整句？（预训练+微调把分类语义"压"进 CLS 位置）
3. BERT 微调为什么学习率要很小？（预训练权重已很好，大步会破坏表示，灾难性遗忘）

## 6. 衍生学习

- Transformer 结构细节（注意力公式推导，见 PyTorch 笔记）
- 蒸馏与量化让 BERT 更快（TinyBERT、INT8）
- 对比学习句向量（SimCSE）

## 7. 参考资料

- [BERT: Pre-training of Deep Bidirectional Transformers](https://arxiv.org/abs/1810.04805)
- [RoBERTa](https://arxiv.org/abs/1907.11692)
- [HuggingFace Transformers](https://huggingface.co/docs/transformers)
