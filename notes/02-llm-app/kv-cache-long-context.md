---
id: kv-cache-long-context
title: KV Cache 原理与长上下文
category: 大模型应用
tags: [KV-Cache, Prompt-Caching, 长上下文, Lost-in-the-Middle]
status: todo
links: [vllm-deployment, manus-multi-step-execution, prompt-engineering]
sources:
  - [Lost in the Middle 论文](https://arxiv.org/abs/2307.03172)
  - [vLLM Prefix Caching 文档](https://docs.vllm.ai/en/latest/automatic_prefix_caching/)
---

# KV Cache 原理与长上下文（待学习）

> 一句话：系统补齐推理侧的底层原理——KV Cache 为什么存在（自回归每步都重复算历史注意力）、Prompt Caching 为什么省钱（前缀相同直接复用 KV）、以及长上下文的"中间遗忘"现象（Lost in the Middle），把 Manus 上下文工程与 vLLM 调优的理论地基补全。

## 是什么 / 为什么值得学

- KV Cache：生成第 t 个 token 时，前 t-1 个的 K/V 不变，缓存后每步只算新 token——用显存换速度；
- 显存账：KV 大小 ∝ 层数 × 序列长 × 2(K/V) × d_model × batch × 精度——这是 max-model-len 与并发调参的根据，也是 PagedAttention/MQA/GQA 要优化的对象；
- Prompt Caching：相同前缀（system prompt、多轮历史）的 KV 直接复用，TTFT 大降（Manus 把整个架构围绕它设计，呼应已学笔记）；
- Lost in the Middle：长上下文里中间位置信息注意力显著衰减 → 关键信息放开头/结尾、todo 复述到尾部等工程手段的理论出处。

## 学习路径

1. 手算一遍 KV Cache 显存（7B 模型、8K 上下文、FP16），与 vLLM 参数对上；
2. 读 Lost in the Middle 实验，整理"位置偏差"对 RAG 片段排序的启示（重要文档放两端）；
3. 串联：MQA/GQA（省 KV）→ PagedAttention（管 KV）→ Prefix Caching（复用 KV）画出知识地图。

## 关键问题（学完应能回答）

- KV Cache 为什么只有 K/V 没有 Q？（Q 只服务当前步，K/V 要被所有后续步访问）
- 上下文越长越好吗？（NO：中间遗忘 + 注意力稀释 + 成本平方级，工程上要"检索浓缩"而非无限堆窗口）

## 参考资料

- [Lost in the Middle](https://arxiv.org/abs/2307.03172)
- [vLLM Automatic Prefix Caching](https://docs.vllm.ai/en/latest/automatic_prefix_caching/)
