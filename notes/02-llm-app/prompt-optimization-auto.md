---
id: prompt-optimization-auto
title: 提示词自动优化（DSPy / APO）
category: 大模型应用
layer: L3-应用工程层
tags: [DSPy, 自动提示词优化, 提示词编译, APO]
status: todo
links: [prompt-engineering]
sources:
  - [DSPy 框架文档](https://dspy.ai/)
  - [Automatic Prompt Engineer（APO）论文](https://arxiv.org/abs/2211.01910)
  - [PromptBreeder 论文](https://arxiv.org/abs/2309.16797)
---

# 提示词自动优化 DSPy / APO（待学习）

> 一句话：把提示词从"手艺"变成"程序"——DSPy 用"签名（输入输出描述）+ 模块 + 优化器"的抽象，让框架基于评测集自动搜索/编译出最优提示词（甚至微调小模型），提示词工程升级为提示词编程。

## 是什么 / 为什么值得学

- 手写提示词的问题：不可迁移（换模型就失效）、不可度量、依赖灵光一现；
- APO 思路：用 LLM 生成候选提示词 → 评测集打分 → 迭代进化（PromptBreeder 甚至让提示词自我繁殖变异）；
- DSPy：声明式编程（`ChainOfThought("question -> answer")`），编译器按指标（如准确率）自动优化提示词/示例/权重——与平台"提示词版本化+评测驱动"的管理思路一脉相承，可以讲成平台下一阶段的自动化方向。

## 学习路径

1. 精读 DSPy 核心概念：Signature / Module / Optimizer（BootstrapFewShot、MIPRO）；
2. 实操：用 DSPy 重写一个政策分类/抽取提示词任务，对比手工提示词的评测分；
3. 了解 OPRO（把优化当 LLM 黑盒搜索）与梯度式 soft-prompt 的边界。

## 关键问题（学完应能回答）

- DSPy 的优化器到底在优化什么？（few-shot 示例选择、指令文本、可选权重）
- 什么场景值得上自动优化？（有评测集、多模型要适配、频繁迭代的核心链路）

## 参考资料

- [DSPy 文档](https://dspy.ai/)
- [Automatic Prompt Engineer](https://arxiv.org/abs/2211.01910)
- [PromptBreeder](https://arxiv.org/abs/2309.16797)
