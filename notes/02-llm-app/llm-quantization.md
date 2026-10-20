---
id: llm-quantization
title: 推理量化（GPTQ / AWQ / FP8）
category: 大模型应用
layer: L2-大模型底层
path: 4.3
difficulty: 深入
tags: [量化, 推理优化, GPTQ, AWQ, 部署]
status: todo
links: [vllm-deployment, model-compression]
sources:
  - [GPTQ 论文](https://arxiv.org/abs/2210.17323)
  - [AWQ 论文](https://arxiv.org/abs/2306.00978)
  - [vLLM 量化文档](https://docs.vllm.ai/en/latest/features/quantization/)
---

# 推理量化 GPTQ / AWQ / FP8（待学习）

> 一句话：量化 = 用更少的位数存权重（16bit → 4bit），显存近乎减半再减半、吞吐上升，精度小幅损失——内网部署 32B/235B 级模型的显存救命稻草（简历场景：政务实验室算力受限）。

## 是什么 / 为什么值得学

- LLM 显存大头是权重：7B@FP16 ≈ 14GB，4bit 后 ≈ 3.5GB——决定"一张卡能不能跑"；
- 主流方案：GPTQ（逐层最小化量化误差的逐列求解）、AWQ（激活感知，保护重要权重通道）、FP8（H100/H800 硬件原生支持）；
- 量化感知训练（QAT）vs 训练后量化（PTQ）：推理侧基本都是 PTQ。

## 学习路径

1. 理解定点量化基础：对称/非对称量化、per-channel/per-group、校准集的作用；
2. 精读 AWQ 的核心洞察（1% 显著权重不量化，靠激活分布找）；
3. 实操：同一个模型跑 FP16 vs AWQ-INT4，测困惑度损失与吞吐/显存对比（vLLM 加载即用）。

## 关键问题（学完应能回答）

- 4bit 量化精度掉多少？什么任务对量化最敏感？（长上下文、数学/代码推理）
- KV Cache 也能量化吗？（KV Cache 量化 vs 权重量化的不同收益面）

## 参考资料

- [GPTQ](https://arxiv.org/abs/2210.17323)
- [AWQ](https://arxiv.org/abs/2306.00978)
- [vLLM Quantization](https://docs.vllm.ai/en/latest/features/quantization/)
