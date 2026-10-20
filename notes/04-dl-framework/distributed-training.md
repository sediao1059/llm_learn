---
id: distributed-training
title: 分布式训练（DDP / DeepSpeed ZeRO）
category: 深度学习基础
layer: L2-大模型底层
tags: [分布式训练, DDP, ZeRO, DeepSpeed, FSDP]
status: todo
links: [pytorch-basics, llm-finetuning, transformer-implementation]
sources:
  - [DeepSpeed ZeRO 论文](https://arxiv.org/abs/1910.02054)
  - [PyTorch DDP 官方教程](https://pytorch.org/tutorials/intermediate/ddp_tutorial.html)
  - [PyTorch FSDP 文档](https://pytorch.org/docs/stable/fsdp.html)
---

# 分布式训练 DDP / DeepSpeed ZeRO（待学习）

> 一句话：单卡装不下/训不快就要并行——DDP 数据并行复制模型切数据（简单但每卡存全量模型），ZeRO 把优化器状态/梯度/参数切片到多卡（显存暴降，微调大模型的多卡标配），FSDP 是 PyTorch 原生同类实现；张量/流水线并行是训练千亿模型再往上的台阶。

## 是什么 / 为什么值得学

- **DDP**：每卡一份完整模型，各卡吃不同 batch，反向后 AllReduce 同步梯度——通信量与模型大小成正比，小模型首选；
- **ZeRO 三级**：Stage1 切优化器状态（Adam 的 m/v 占大头）→ Stage2 加切梯度 → Stage3 连参数一起切，8 卡可把显存需求降到约 1/8——这就是 LoRA 微调 GLM-4-9B/更大模型时"多卡怎么用"的答案；
- **FSDP**：PyTorch 内置的 ZeRO-3 等价物；**TP（张量并行）/PP（流水线并行）**：训练百亿千亿模型的进一步切法；
- 关键认知：LoRA/QLoRA 已把微调显存打下来，**分布式是大模型全参训练与预训练的必修课**。

## 学习路径

1. 理解 ZeRO 论文的显存账（混合精度下 Adam 优化器状态 = 12 bytes/参数 的推导）；
2. 实操：torchrun 两卡 DDP 跑通 mini 训练；再用 DeepSpeed Stage2/3 跑同一任务对比显存；
3. 掌握排查工具：nccl 超时、负载不均、梯度 NaN 的常见原因。

## 关键问题（学完应能回答）

- 为什么 Adam 状态占显存比参数本身大？（fp16 参数 + fp32 master 权重 + 两个动量 ≈ 16 bytes/param vs 权重 2 bytes）
- ZeRO-3 与 TP 的区别？（前者按层切片串行换显存，后者层内切矩阵并行算力换时间）

## 参考资料

- [ZeRO: Memory Optimizations Toward Training Trillion Parameter Models](https://arxiv.org/abs/1910.02054)
- [PyTorch DDP 教程](https://pytorch.org/tutorials/intermediate/ddp_tutorial.html)
- [PyTorch FSDP](https://pytorch.org/docs/stable/fsdp.html)
