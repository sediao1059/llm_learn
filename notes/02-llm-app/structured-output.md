---
id: structured-output
title: 结构化输出与约束解码
category: 大模型应用
layer: L2-大模型底层
difficulty: 进阶
tags: [结构化输出, JSON-Schema, 约束解码, Function-Call]
status: todo
links: [function-call, prompt-engineering]
sources:
  - [OpenAI Structured Outputs 博客](https://openai.com/index/introducing-structured-outputs-in-the-api/)
  - [Outlines（开源约束解码库）](https://github.com/dottxt-ai/outlines)
  - [xgrammar（高效语法约束）](https://github.com/mlc-ai/xgrammar)
---

# 结构化输出与约束解码（待学习）

> 一句话：让模型输出 100% 合法的 JSON/枚举/正则格式——不是靠提示词求"请输出JSON"，而是在解码阶段把不合语法的 token 概率直接置零（语法约束解码），从机制上杜绝格式错误。

## 是什么 / 为什么值得学

- 三层方案演进：提示词约束（会翻车）→ Function Call/JSON Mode（训练对齐 + 重试）→ 约束解码（编译 JSON Schema/CFG 为状态机，逐 token 屏蔽非法分支，数学上保证合法）；
- 应用面：Agent 工具调用参数、问数的 SQL 生成、抽取任务字段、前后端系统对接——一切"模型输出要进程序"的场景；
- 工程细节：约束解码的开销（每步状态机推进）、与 vLLM/SGLang 的集成（guided decoding）。

## 学习路径

1. 理解"文法 → 自动机 → token 屏蔽"的原理链（Outlines 的核心思想）；
2. 实操：vLLM guided_json 起服务，让政策抽取输出严格 Schema，对比裸提示词的格式错误率；
3. 了解 OpenAI Structured Outputs 的约束策略（首 token 约束 + 拒绝采样）。

## 关键问题（学完应能回答）

- 约束解码会不会伤模型质量？（合法但内容变差的可能：强 schema 下的"模式坍缩"）
- 与 Function Call 是什么关系？（FC 是训练出的能力，约束解码是推理期机制，可叠加）

## 参考资料

- [Introducing Structured Outputs in the API](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [Outlines](https://github.com/dottxt-ai/outlines)
- [XGrammar](https://github.com/mlc-ai/xgrammar)
