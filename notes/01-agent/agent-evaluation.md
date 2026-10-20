---
id: agent-evaluation
title: Agent 评测（GAIA / LLM-as-Judge / RAGAS）
category: Agent 系统
layer: L3-应用工程层
path: 5.5
difficulty: 进阶
tags: [评测, GAIA, LLM-as-Judge, 基准]
status: todo
links: [manus-multi-step-execution, genspark-search-agent, hallucination-mitigation]
sources:
  - [GAIA 基准论文](https://arxiv.org/abs/2311.12983)
  - [LLM-as-Judge 论文（MT-Bench）](https://arxiv.org/abs/2306.05685)
  - [RAGAS（RAG 评测框架）](https://docs.ragas.io/)
---

# Agent 评测：GAIA / LLM-as-Judge / RAGAS（待学习）

> 一句话：Agent 迭代的前提是可评测——任务级基准（GAIA）、自动评分（LLM-as-Judge）、RAG 分段评测（RAGAS：忠实度/相关性/召回率），三层组合解决"改一版到底变好还是变坏"的问题（对应 Genspark 改进飞轮与简历平台的评测需求）。

## 是什么 / 为什么值得学

- **GAIA**：通用助手基准，问题需要多步工具调用（检索/计算/浏览），人很容易做对而普通 LLM 系统大幅落后——Manus 借它出圈；Agent 任务评测的设计范式（答案可自动比对）；
- **LLM-as-Judge**：强模型当裁判给输出打分/排序（MT-Bench 验证与人类偏好高相关）——注意偏差：位置偏差、冗长偏差、自我偏好；步骤级归因是 Genspark 改进飞轮的核心；
- **RAGAS**：RAG 专项指标——Faithfulness（答案是否被材料支持）、Answer Relevance、Context Recall/Precision，把"检索对了还是生成对了"拆开看；
- 工程要点：固定评测集 + 版本对比 + badcase 回流闭环（平台侧的正负样本机制的自动化版）。

## 学习路径

1. 读 GAIA 的任务设计与评分方式，挑 5 道题给自己的 Agent 跑分；
2. 用 RAGAS 评一次现有 RAG 链路，定位瓶颈在检索还是生成；
3. 搭建最小评测流水线：评测集入库 → 每次改动自动跑 → 报告对比（Jenkins/Airflow 定时均可）。

## 关键问题（学完应能回答）

- LLM 裁判可信吗？怎么降低偏差？（换序双评、评分标准结构化、人工抽检校准）
- Agent 评测与单轮生成评测的本质区别？（过程指标：工具选择正确率、步数、恢复率；结果指标：任务完成率）

## 参考资料

- [GAIA: A Benchmark for General AI Assistants](https://arxiv.org/abs/2311.12983)
- [Judging LLM-as-a-Judge with MT-Bench](https://arxiv.org/abs/2306.05685)
- [RAGAS](https://docs.ragas.io/)
