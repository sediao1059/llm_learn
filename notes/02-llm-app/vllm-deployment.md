---
id: vllm-deployment
title: 模型部署与推理服务（vLLM）
category: 大模型应用
tags: [vLLM, 推理优化, PagedAttention, 量化, 部署]
status: learned
links: [llm-finetuning]
sources:
  - [vLLM 官方文档](https://docs.vllm.ai/)
  - [PagedAttention 论文（vLLM 核心）](https://arxiv.org/abs/2309.06180)
---

# 模型部署与推理服务（vLLM）

> **一句话**：vLLM 是当前最主流的开源 LLM 推理引擎，两大杀手锏——**PagedAttention**（把 KV Cache 像操作系统内存页一样分页管理，显存利用率大幅提升）和 **Continuous Batching**（请求随到随拼批，吞吐数倍提升）。简历场景：基于 vLLM 完成内网 Qwen-32B / Qwen-235B / GLM-5.1/5.3 及向量化模型的部署与调优。

## 1. 为什么推理服务是个"显存游戏"

- 生成是**逐 token** 的自回归过程，每个请求的历史 K/V 都要缓存（KV Cache）——序列越长缓存越大；
- 传统做法给每个请求预留连续最大长度显存 → 大量浪费（内部/外部碎片）；vLLM 借操作系统**分页**思想按块分配，几乎消除碎片，同等显存可并发更多请求（论文：吞吐 2~4 倍于 naive 方案）；
- KV Cache 与模型权重抢显存：`可用 KV 显存 ≈ 总显存 − 权重 − 激活值`，这是调优的核心公式。

## 2. vLLM 关键机制

| 机制 | 一句话理解 |
|---|---|
| PagedAttention | KV Cache 分页管理，逻辑连续物理离散，消除浪费 |
| Continuous Batching | 迭代级调度：短请求完成即出队、新请求随时入批，GPU 不空转 |
| Prefix Caching | 相同前缀（system prompt/多轮历史）的 KV 直接复用，TTFT 大降（与 Agent 场景天然契合，呼应 Manus 的缓存哲学） |
| Tensor Parallel | 权重按张量切分到多卡并行（大模型单卡放不下必用，如 235B 级别） |
| OpenAI 兼容 API | 起服务即是 `/v1/chat/completions` 标准接口，业务零改造切换模型 |
| Embedding 服务 | vLLM 也能托管 BGE 等向量化模型，RAG 检索与生成同栈部署 |

## 3. 部署与调优实战要点（简历场景对齐）

```bash
# 典型启动：内网离线部署 Qwen-32B，双卡张量并行
vllm serve Qwen/Qwen2.5-32B-Instruct \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 32768 \
  --enable-prefix-caching
```

- **`gpu-memory-utilization`**：留给 KV Cache 的比例，0.85~0.95 常见；太高会 OOM，太低浪费并发；
- **`max-model-len`**：按业务最长输入输出设置，不必跟满模型上限（直接决定 KV 预留上限）；
- **量化部署**：显存不够时 AWQ/GPTQ 4bit（精度小幅下降、显存近半）；A100/H100 可试 FP8；
- **调优抓手**：看三个指标——吞吐（tokens/s）、首字延迟 TTFT、并发数；压测工具 `vllm bench serve` 或自建并发脚本；
- **内网/政务环境**：模型权重离线导入、无外网依赖、多模型多实例统一路由（配合平台的模型管理与配置功能），算力服务器资源审核（利用率/排队）也是交付内容；
- **多模型并存**：大模型（对话/生成）+ 小模型（分类/抽取，微调产物）+ 向量化模型（RAG）三类各起服务，按场景路由——这正是"多模型配置"的底层形态。

## 4. 生态位对比（一句话版）

- **vLLM**：吞吐/生态标杆，PagedAttention；
- **SGLang**：RadixAttention 前缀复用更强，Agent 多轮场景有优势；
- **llama.cpp / Ollama**：CPU/消费级显卡本地跑，轻量开发用；
- **TensorRT-LLM**：NVIDIA 官方，极限性能但工程门槛高。

## 5. 高频面试题

1. PagedAttention 解决什么问题？（KV Cache 显存碎片与浪费，提升并发吞吐）
2. TTFT 和吞吐怎么权衡？（并发 batch 越大吞吐越高但首字延迟升；prefix caching/较短 max-len 优化 TTFT）
3. 部署 32B 模型至少要什么资源？（FP16 权重约 64GB → 2×48G 或 4×24G 卡 + KV 余量；量化可减半）
4. QPS 上不去排查顺序？（先看 GPU 利用率→是否排队→max-model-len/并发参数→量化或扩容）

## 6. 衍生学习

- 推理量化原理（GPTQ/AWQ/FP8）
- 投机解码（Speculative Decoding）
- SGLang / TensorRT-LLM 深入对比

## 7. 参考资料

- [vLLM 官方文档](https://docs.vllm.ai/)
- [Efficient Memory Management for LLM Serving with PagedAttention](https://arxiv.org/abs/2309.06180)
