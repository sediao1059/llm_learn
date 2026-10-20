---
id: transformer-architecture
title: Transformer 架构原理
category: 深度学习基础
layer: L1-算法底层
tags: [Transformer, 注意力机制, 位置编码, 架构]
status: learned
links: [pytorch-basics, bert-series, transformer-implementation]
sources:
  - [Attention Is All You Need（原始论文）](https://arxiv.org/abs/1706.03762)
  - [The Illustrated Transformer（Jay Alammar 图解）](https://jalammar.github.io/illustrated-transformer/)
  - [RoPE 旋转位置编码论文](https://arxiv.org/abs/2104.09864)
---

# Transformer 架构原理

> **一句话**：Transformer 完全抛弃 RNN 的循环结构，靠**自注意力（Self-Attention）**让序列中每个位置直接"看到"所有其他位置——一次矩阵乘法全局建模，可完全并行。它是 BERT、GPT 及一切现代大模型的骨架。**学习路径：本文（原理）→ 手写实现（transformer-implementation）→ 分支到 BERT（理解）或 GPT（生成）**。

## 1. 为什么需要它（对比 RNN）

| 痛点 | RNN/LSTM | Transformer |
|---|---|---|
| 长距离依赖 | 信息逐步传递，远了就忘 | 任意两位置直接连边（路径长度 1） |
| 训练并行 | 必须按时间步串行 | 全序列一次算，GPU 吃满 |
| 长句计算量 | O(n) 逐步 | O(n²) 两两注意（这也是它的代价） |

## 2. 总体结构

```
输入 token → Embedding(d=512) + 位置编码
   ▼
┌─────────── N× Block（原论文 N=6）──────────┐
│  Multi-Head Self-Attention                  │
│  （残差连接 + LayerNorm）                    │
│  Feed-Forward（两层 MLP，中间维 4d）          │
│  （残差连接 + LayerNorm）                    │
└────────────────────────────────────────────┘
   ▼
decoder-only（GPT）：N× Block（带因果掩码）→ lm_head → 下一个词概率
encoder-only（BERT）：N× Block（双向）→ [CLS] / 各位置输出
```

## 3. 自注意力核心（必考公式）

$$\text{Attention}(Q,K,V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

- **直觉**：每个 token 发出 Query（我在找什么），所有 token 提供 Key（我是什么）+ Value（我的信息）；Q·K 相似度决定"该看谁"，softmax 成权重后对 V 加权求和——**每个位置的新表示是全序列的加权平均**；
- **为什么除 √d_k**：点积随维度增大而变大，softmax 进入饱和区梯度趋零，除以 √d_k 把方差拉回 1；
- 三种角色：
  - **Self-Attention**（encoder/BERT）：Q、K、V 同源，双向可见；
  - **Masked Self-Attention**（decoder/GPT）：上三角掩码设 −∞，位置 i 只能看 ≤i（保证自回归训练不偷看答案）；
  - **Cross-Attention**（原 decoder）：Q 来自 decoder，K/V 来自 encoder（翻译类 seq2seq 用，decoder-only LLM 没有）。

## 4. 多头注意力（MHA）

- h=8 个头各自做注意力（每头维度 d_k = d/h = 64），输出拼接后再投影；
- **为什么多头**：一个头只能学一种对齐模式；多头让模型同时关注语法、指代、位置等不同关系（子空间分工）；
- 现代变体：MQA/GQA（多查共享 KV，为推理省 KV Cache，vLLM 笔记延伸）。

## 5. 位置编码

- 注意力本身对顺序无感（打乱输入结果不变），必须注入位置信息；
- 原论文：正弦/余弦固定编码；BERT：可学习绝对位置；
- **现代主流 RoPE（旋转位置编码）**：把 Q/K 向量按角度旋转，注意力分数只依赖相对位置差——外推性更好（长上下文友好），Llama/Qwen/GLM 全在用。

## 6. FFN、残差与归一化

- **FFN**：`Linear(d→4d) → GELU → Linear(4d→d)`，逐位置独立；现代 LLM 用 SwiGLU 变体；占参数量约 2/3，被认为是"知识存储"的主要位置；
- **残差连接**：`x + Sublayer(LN(x))`，保住梯度高速通道，深网络能训；
- **Pre-LN vs Post-LN**：原论文 Post-LN（LN 在残差后）深了难训；现代模型基本 Pre-LN（LN 在子层前），LLaMA 系用 RMSNorm（去掉均值中心化，更快）。

## 7. 参数量直觉（面试估算题）

以 d=512、L=6、词表 V≈30k 估算：每层 ≈ 12d²（注意力 4d² + FFN 8d²）≈ 3.15M，6 层 ≈ 19M，加 embedding/lm_head（可共享权重）≈ 34M+ —— BERT-Base（110M）就是把 d=768、L=12 代入的量级。**记公式：总参数 ≈ L × 12d² + V×d**。

## 8. 三种架构取舍（为什么 LLM 主流 decoder-only）

| 架构 | 代表 | 注意力 | 擅长 |
|---|---|---|---|
| Encoder-only | BERT | 双向 | 理解类：分类/抽取/匹配 |
| Encoder-Decoder | T5、翻译模型 | encoder 双向 + decoder 单向交叉 | 序列到序列转换 |
| Decoder-only | GPT/Llama/Qwen/GLM | 单向因果 | 生成统一范式：一切任务都化为"续写"，缩放定律最友好，训练目标 = 推理行为 |

## 9. 高频面试题

1. 写出注意力公式并解释 √d_k？（见 §3）
2. 为什么需要多头？（多模式对齐，子空间分工）
3. Pre-LN 与 Post-LN 区别？为什么现代模型用 Pre-LN？（训练稳定性，梯度直通）
4. BERT 与 GPT 的注意力掩码差异？（双向 vs 因果上三角掩码）
5. RoPE 相比绝对位置编码的优势？（相对性 + 长度外推）
6. 自注意力复杂度？长序列瓶颈？（O(n²)；引出稀疏注意力/FlashAttention/KV Cache）

## 10. 学习路径

1. 本文吃透公式与结构 → 2. 对照手写实现（下一节点）逐行验证理解 → 3. 回看 BERT 笔记（MLM 如何用 encoder）→ 4. 看 vLLM/KV Cache（推理侧如何缓存 K/V）。

## 11. 衍生学习

- 手写实现（下一个节点，强前置）
- FlashAttention（IO 感知的精确注意力加速）
- 稀疏注意力与长上下文技术

## 12. 参考资料

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/)
- [RoFormer: RoPE](https://arxiv.org/abs/2104.09864)
