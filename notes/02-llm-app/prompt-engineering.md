---
id: prompt-engineering
title: 提示词工程
category: 大模型应用
tags: [Prompt, LLM, 提示词优化, CoT]
status: learned
links: [function-call, rag-vector-kb, hallucination-mitigation, agent-memory-personalization]
sources:
  - [OpenAI Prompt Engineering 官方指南](https://platform.openai.com/docs/guides/prompt-engineering)
  - [Anthropic Prompt Engineering 文档](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
  - [Lilian Weng: Prompt Engineering（系统性综述博客）](https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/)
---

# 提示词工程（Prompt Engineering）

> **一句话**：提示词工程 = 用结构化的方式把「角色、任务、上下文、约束、输出格式、示例」讲给模型听，并通过版本化管理和评测持续优化。它是大模型应用里**性价比最高的杠杆**——不动模型、不改架构，效果立竿见影。

## 1. 一个好提示词的六要素

```
1. 角色（Role）      ：你是一个政务政策分析专家……
2. 任务（Task）      ：判断企业是否符合政策申报条件
3. 上下文（Context） ：{企业画像} + {政策原文}
4. 约束（Rules）     ：只依据给定材料回答；不确定时输出"无法判断"
5. 输出格式（Format）：JSON，字段为 {match: bool, reason: string}
6. 示例（Examples）  ：给 1–3 个典型输入输出对（few-shot）
```

实战经验：
- **system 与 user 分离**：稳定的行为约束放 system（前缀稳定还有利于 KV Cache 命中，参见关联节点「Manus 多步任务执行模式」），易变内容放 user；
- **分隔符隔离外部内容**：检索到的文档、用户输入用 `<docs>...</docs>` 包起来，防止内容被当指令（提示注入）；
- **输出格式用 JSON Schema / 结构化约束**，配合 Function Call 强约束最佳。

## 2. 常用推理增强技巧

| 技巧 | 做法 | 适用 |
|---|---|---|
| Zero-shot | 直接问 | 简单任务 |
| Few-shot | 给几个示例 | 格式/风格要求高的任务（注意示例偏差，参考 Manus「避免 few-shot 陷阱」） |
| CoT（思维链） | "先一步步推理再给答案" | 数学、多步逻辑 |
| Self-Consistency | 采样多条推理路径取多数 | 提升复杂推理稳定性 |
| 结构化分步 | 拆成「抽取→判断→总结」多次调用 | 长流程任务，每步可控可测 |

## 3. 提示词压缩与提速（简历场景）

教育平台项目中「多模型配置与提示词优化、压缩提升响应速度」的落点：
- **语义等价压缩**：删除冗余客套与重复约束、合并同类规则、示例精简到最小必要集——输入 token 直接决定首字延迟与成本；
- **前缀稳定**：system 部分固定不变，动态内容追加在后，命中 Prompt Caching（缓存命中约为未命中价格的 1/10）；
- **分而治之**：长提示词拆成「小模型做格式化/抽取 + 大模型做核心推理」的分工，还能配合多模型路由降本。

## 4. 提示词的工程化管理

把提示词当代码管理，而不是字符串魔法：
- **版本化**：提示词入库（配置/数据库），记录变更历史，可回滚；
- **评测驱动**：固定一批测试样本（含边界 case），每次改动跑一遍对比（可配合 LLM-as-Judge 自动评分）；
- **A/B 与灰度**：不同用户组用不同版本，看真实指标（解决率、采纳率）；
- **参数联动**：temperature 分类任务调低（0~0.3）、生成任务调高（0.7+），与提示词一起管理。

## 5. 高频面试题

1. system prompt 和 user prompt 的区别？为什么要分离？（行为约束 vs 单次输入；缓存前缀）
2. few-shot 示例越多越好吗？（不是；有偏差放大与成本问题，需要代表性而非数量）
3. 提示词注入（prompt injection）怎么防？（分隔符+指令隔离、外部内容标记为数据、输出校验、最小权限工具）
4. 提示词优化到什么程度该考虑微调？（格式/风格类收益大；知识与行为类收益递减时转 RAG/微调，见微调笔记的决策表）

## 6. 衍生学习

- 提示词自动优化（DSPy、APO）
- 结构化输出与 JSON Mode / Constrained Decoding
- 多模型提示词适配（同一任务不同模型的提示词差异）

## 7. 参考资料

- [OpenAI Prompt Engineering 官方指南](https://platform.openai.com/docs/guides/prompt-engineering)
- [Anthropic Prompt Engineering 文档](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- [Lilian Weng: Prompt Engineering](https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/)
