---
id: deep-research-products
title: Deep Research 产品架构
category: Agent 系统
layer: L4-业务应用层
difficulty: 入门
tags: [Deep-Research, 深度研究, 搜索Agent, 报告生成]
status: todo
links: [genspark-search-agent, rag-vector-kb, agent-paradigms]
sources:
  - [OpenAI Deep Research 发布博客](https://openai.com/index/introducing-deep-research/)
  - [Google Gemini Deep Research](https://blog.google/products/gemini/deep-research/)
---

# Deep Research 产品架构（待学习）

> 一句话：Deep Research（OpenAI/Gemini 2025 年起的产品线）= "多源检索 Agent + 长程规划 + 结构化报告生成"的产品化封装：输入问题，自主浏览几十上百个来源、交叉验证、迭代补查，产出带引用的研究报告——Genspark 搜索架构的当代直系后裔，也是"智能问数/政策研究"场景的最佳参照物。

## 是什么 / 为什么值得学

- 与普通 RAG 的区别：开放网络实时检索（非固定库）、任务时长 5-30 分钟、迭代式查询（计划→搜→读→发现新线索→再搜）、引用溯源贯穿；
- 架构要点（公开资料归纳）：研究计划生成 → 并行子任务扇出（子 Agent 分头检索）→ 源质量评估与交叉验证 → 大纲驱动写作 → 引用对齐校验；
- 计算侧：o3/Deep Research 类模型牺牲时延换深度推理，"异步任务 + 完成通知"的产品形态（与 Manus 异步执行同构）；
- 对自己场景的映射：政策研究报告自动生成 = 政策库 Deep Research + 结构化要素抽取。

## 学习路径

1. 对比体验 OpenAI DR 与 Gemini DR 同一问题的报告质量、引用格式、追问能力；
2. 拆解一篇官方博客的技术描述，画出自研版架构图（检索层/规划层/写作层/校验层）；
3. 用 Agent SDK 做一个 mini-DR：计划 → 3 轮迭代检索 → 引用化输出。

## 关键问题（学完应能回答）

- DR 与 ChatBot + 联网搜索的差异？（多跳自主迭代 vs 单轮检索增强；深度预算管理）
- 报告幻觉怎么控？（每段引用溯源、源可信度加权、矛盾信息显式呈现）

## 参考资料

- [Introducing Deep Research (OpenAI)](https://openai.com/index/introducing-deep-research/)
- [Gemini Deep Research (Google)](https://blog.google/products/gemini/deep-research/)
