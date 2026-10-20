---
id: speculative-decoding
title: 投机解码（Speculative Decoding）
category: 大模型应用
layer: L2-大模型底层
path: 4.4
difficulty: 深入
tags: [推理加速, 投机解码, Medusa, KV-Cache]
status: todo
links: [vllm-deployment, llm-quantization]
sources:
  - [Speculative Decoding 原始论文](https://arxiv.org/abs/2302.01318)
  - [Medusa（多头并行草稿）](https://arxiv.org/abs/2401.10774)
---

# 投机解码（待学习）

> 一句话：让小模型先"猜"K 个 token，大模型一次前向并行验证，猜对就一步白嫖 K 个 token——无损精度、成倍降低解码延迟，是自回归解码加速的经典思路。

## 是什么 / 为什么值得学

- 自回归生成的瓶颈：每生成一个 token 都要过一遍大模型，串行、GPU 吃不满；
- 投机解码三步：草稿模型快速生成 K 个候选 → 目标大模型一次前向同时算 K+1 个位置 → 接受最长正确前缀（拒绝采样保证分布与大模型完全一致，**数学上无损**）；
- 变体：Medusa（在目标模型上加多个预测头同时猜多个未来位置，不需要单独草稿模型）、EAGLE、自投机等。

## 学习路径

1. 理解拒绝采样为什么能保证"无损"（接受概率的构造）；
2. 算清楚加速条件：接受率 × K 与额外草稿开销的盈亏平衡点（草稿与大模型的"血缘"越近接受率越高，如同系列大小模型）；
3. 了解 vLLM/SGLang 对投机解码的工程支持与实测收益场景（批量小时收益大）。

## 关键问题（学完应能回答）

- 为什么验证 K 个 token 只需一次前向？（因果注意力的 teacher forcing 并行性）
- 什么场景收益最大/最小？（低并发时延敏感 vs 高吞吐批量场景）

## 参考资料

- [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2302.01318)
- [Medusa](https://arxiv.org/abs/2401.10774)
