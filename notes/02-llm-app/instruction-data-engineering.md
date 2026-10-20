---
id: instruction-data-engineering
title: 指令数据工程（合成 / 去重 / 质检）
category: 大模型应用
layer: L2-大模型底层
tags: [数据工程, 指令微调, Self-Instruct, 数据质量]
status: todo
links: [llm-finetuning, prompt-engineering]
sources:
  - [Self-Instruct 论文](https://arxiv.org/abs/2212.10560)
  - [WizardLM / Evol-Instruct 论文](https://arxiv.org/abs/2304.12244)
  - [LIMA（Less is More for Alignment）](https://arxiv.org/abs/2305.11206)
---

# 指令数据工程（待学习）

> 一句话：微调效果七分靠数据——指令数据的合成（Self-Instruct/Evol-Instruct）、清洗去重、难度与多样性配比、质检与去污染，是把 LoRA 从"能跑"带到"能用"的核心手艺（简历场景：政策垂类微调的数据构造正需要系统化）。

## 是什么 / 为什么值得学

- LIMA 结论：1000 条精挑数据 > 海量噪声数据，**质量与多样性 >> 数量**；
- 合成范式：Self-Instruct（模型自举生成指令）、Evol-Instruct（指令"进化"：加深/加广/换域）、大模型造数+人工抽检（政策垂类实操路线）；
- 数据质量四件事：去重（语义级 MinHash/embedding 聚类）、难度分层、格式校验、评测集防泄漏（数据污染检查）。

## 学习路径

1. 精读 Self-Instruct 的自举流程与过滤规则；
2. 给政策分类任务设计一套造数流水线：种子样本 → 大模型扩展 → 规则+模型双质检 → 难例人工审；
3. 实验对比：同一 LoRA 配置下 500 条精数据 vs 5000 条粗数据的评测差异。

## 关键问题（学完应能回答）

- 怎么衡量指令数据的"多样性"？（指令聚类分布、实体覆盖度、长度分布）
- 合成数据的风险与对策？（模式单一→模型学偏；幻觉样本→双重校验）

## 参考资料

- [Self-Instruct](https://arxiv.org/abs/2212.10560)
- [Evol-Instruct / WizardLM](https://arxiv.org/abs/2304.12244)
- [LIMA](https://arxiv.org/abs/2305.11206)
