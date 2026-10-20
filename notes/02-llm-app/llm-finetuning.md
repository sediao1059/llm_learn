---
id: llm-finetuning
title: 大模型微调（LoRA / Prompt-Tuning）
category: 大模型应用
layer: L2-大模型底层
tags: [微调, LoRA, PEFT, SFT, GLM]
status: learned
links: [pytorch-basics, bert-series, vllm-deployment]
sources:
  - [LoRA 论文（Hu et al., 2021）](https://arxiv.org/abs/2106.09685)
  - [QLoRA 论文](https://arxiv.org/abs/2305.14314)
  - [HuggingFace PEFT 文档](https://huggingface.co/docs/peft)
  - [LLaMA-Factory（一站式微调框架）](https://github.com/hiyouga/LLaMA-Factory)
---

# 大模型微调（LoRA / Prompt-Tuning）

> **一句话**：微调 = 用领域数据继续训练大模型，让它学会**行为与领域语言**（不等于记住知识）。全参微调太贵，PEFT（参数高效微调）只训练极少量新增参数：LoRA 给权重矩阵挂低秩旁路，Prompt-Tuning 学一段"软提示"。简历场景：基于 GLM-4-9B 做 LoRA 微调训练政策垂类小模型，用于政策分类与信息提取。

## 1. 三种路线对比

| 路线 | 训练参数量 | 显存（7B~9B 级） | 适用 |
|---|---|---|---|
| 全参微调（Full FT） | 100% | 极高（多卡 + 深度优化） | 预算充足、行为重塑需求强 |
| LoRA（及其变体） | <1%（新增旁路） | 单卡可跑（QLoRA 更低） | 大多数垂域任务的主力选择 |
| Prompt/Prefix/P-Tuning | ~0.01%（软提示向量） | 最低 | 超大模型、任务风格迁移 |

## 2. LoRA 原理（必考）

- 核心假设：微调引起的权重变化量 ΔW 是**低秩**的；
- 做法：冻结原权重 W，训练一个旁路 `W' = W + BA`，其中 B∈R^(d×r)、A∈R^(r×k)，秩 r 常取 8/16/64 —— 只训练 BA，参数量骤降两个数量级；
- 推理时可把 BA 合并回 W（**零额外推理延迟**）；
- 关键超参：`r`（容量）、`alpha`（缩放）、作用于哪些模块（q/k/v/o 投影，后期实践常一并作用于 FFN）；
- **QLoRA**：基座 4bit 量化加载（NF4）+ LoRA，单张消费级显卡微调大模型成为可能。

## 3. Prompt-Tuning / P-Tuning v2（简历技能点）

- **Prompt-Tuning**：在输入 embedding 前拼接一小段**可学习的连续向量**（软提示），冻结模型全部参数只训这段向量；
- **Prefix-Tuning / P-Tuning v2**：把可学习向量加到**每一层** Transformer 的 KV 前面（不只是输入层），小模型上也有效；
- 与"提示词工程"的本质区别：提示词是**人写的离散 token**，Prompt-Tuning 是**梯度学出来的连续向量**，不占用上下文窗口；
- 经验：任务越需要"改变知识/深水区行为"，越需要 LoRA 级别；只是风格/格式适配，软提示够用。

## 4. 微调 vs RAG vs 提示词（决策表，面试必问）

| 需求 | 首选 |
|---|---|
| 知识频繁更新、要溯源引用 | RAG |
| 私有大文本库问答 | RAG（+微调增强遵循） |
| 输出风格/格式/术语体系固化 | 微调（LoRA） |
| 领域抽取/分类任务要高精度低成本 | 微调垂类小模型 |
| 快速验证、低成本试错 | 提示词工程 |
| 组合拳 | 先 RAG+提示词，瓶颈在"模型不会用材料/术语错"时再 LoRA |

## 5. 简历场景实操复盘（政策垂类模型）

1. **数据构造**（最关键，占 70% 工作量）：政策分类样本 = 政策原文片段 + 标签体系（行业/规模/适用对象）；信息提取样本构造为指令格式 `{instruction, input, output}`；用大模型辅助造数 + 人工校验（正负样本均衡，含难例）；
2. **训练**：GLM-4-9B + LoRA（LLaMA-Factory / PEFT），指令微调（SFT）范式，几轮 epoch、小学习率（1e-4 级）防过拟合；
3. **评测**：留出集算分类 F1 / 抽取准确率，与"大模型零样本 + 提示词"基线对比，证明微调收益；
4. **部署**：LoRA 合并权重后交 vLLM 部署（见 vllm-deployment 笔记）；
5. **迭代**：badcase 回流 → 补数据 → 再训，形成闭环。

## 6. 高频面试题

1. LoRA 为什么有效？r 怎么选？（低秩假设；r=8/16 起步，任务复杂/数据多加大，看评测曲线）
2. SFT 和 RLHF/DPO 的区别？（SFT 模仿示范；RLHF/DPO 基于偏好优化对齐）
3. 微调数据多少条合适？（指令微调几百~几千条高质量样本常已显著有效，质量>>数量）
4. 微调后模型通用能力下降（灾难性遗忘）怎么办？（混合通用数据、更小学习率、LoRA 天然缓解）

## 7. 衍生学习

- RLHF / DPO / GRPO 对齐技术
- 微调框架横评：LLaMA-Factory vs Axolotl vs ms-swift
- 数据工程：指令数据合成与去重

## 8. 参考资料

- [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685)
- [QLoRA](https://arxiv.org/abs/2305.14314)
- [HuggingFace PEFT](https://huggingface.co/docs/peft)
- [LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory)
