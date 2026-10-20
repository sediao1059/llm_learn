---
id: transformer-implementation
title: Transformer 手写实现（mini-GPT）
category: 深度学习基础
layer: L1-算法底层
path: 1.3
difficulty: 进阶
tags: [Transformer, PyTorch, 手写实现, GPT, 代码]
status: learned
links: [transformer-architecture, pytorch-basics, llm-finetuning]
sources:
  - [nanoGPT（Karpathy 参考实现，必读）](https://github.com/karpathy/nanoGPT)
  - [The Annotated Transformer（Harvard NLP 逐行注解版）](https://nlp.seas.harvard.edu/annotated-transformer/)
  - [PyTorch 官方 Transformer 教程](https://pytorch.org/tutorials/beginner/transformer_tutorial.html)
---

# Transformer 手写实现（mini-GPT）

> **一句话**：用 PyTorch 从零写一个 ~150 行的 mini-GPT（因果注意力 + 残差块 + 下一个词预测），跑通"训练 loss 下降 → 能生成连贯文本"就算毕业。**前置：先吃透架构原理（上一节点）和 PyTorch 训练循环；学法是"每写一个模块就回头对一次公式"**。

## 1. 目标与骨架

实现一个 decoder-only 小模型：字符级分词 + 可学习位置编码 + N 个 Block + 语言建模头。

```python
import math, torch
import torch.nn as nn
import torch.nn.functional as F

class GPTConfig:
    vocab_size = 1024   # 字符级词表
    d_model = 256       # 嵌入维 d
    n_head = 8          # 注意力头数（d/h=32 每头）
    n_layer = 4         # Block 数
    block_size = 256    # 上下文长度
```

## 2. 因果自注意力（核心中的核心）

```python
class CausalSelfAttention(nn.Module):
    def __init__(self, cfg):
        super().__init__()
        self.qkv = nn.Linear(cfg.d_model, 3 * cfg.d_model)   # 一次投影出 Q,K,V
        self.proj = nn.Linear(cfg.d_model, cfg.d_model)
        self.n_head = cfg.n_head
        self.d_head = cfg.d_model // cfg.n_head
        # 上三角掩码：位置 i 只允许看 [0, i]，未来置 -inf
        mask = torch.triu(torch.ones(cfg.block_size, cfg.block_size), diagonal=1) * float('-inf')
        self.register_buffer('mask', mask)

    def forward(self, x):                     # x: (B, T, d)
        B, T, d = x.shape
        q, k, v = self.qkv(x).split(d, dim=2) # 各 (B, T, d)
        # 拆头：(B, T, d) → (B, h, T, d_head)，让每头独立做注意力
        q = q.view(B, T, self.n_head, self.d_head).transpose(1, 2)
        k = k.view(B, T, self.n_head, self.d_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, self.d_head).transpose(1, 2)
        # Attention(Q,K,V) = softmax(QKᵀ/√d_head)V + 掩码
        att = (q @ k.transpose(-2, -1)) / math.sqrt(self.d_head)  # (B,h,T,T)
        att = att + self.mask[:T, :T]
        att = F.softmax(att, dim=-1)
        y = att @ v                                            # (B,h,T,d_head)
        y = y.transpose(1, 2).contiguous().view(B, T, d)        # 拼头
        return self.proj(y)
```

对照公式检查三处：`/√d_head`、mask 加在 softmax **之前**、拆头后拼头前要 transpose。

## 3. FFN 与 Block（Pre-LN 残差）

```python
class FFN(nn.Module):
    def __init__(self, d, hidden=4 * d):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d, hidden), nn.GELU(), nn.Linear(hidden, d))
    def forward(self, x): return self.net(x)

class Block(nn.Module):
    def __init__(self, cfg):
        super().__init__()
        self.ln1 = nn.LayerNorm(cfg.d_model)
        self.attn = CausalSelfAttention(cfg)
        self.ln2 = nn.LayerNorm(cfg.d_model)
        self.ffn = FFN(cfg.d_model)
    def forward(self, x):
        x = x + self.attn(self.ln1(x))   # Pre-LN：先归一化再进子层，残差直通
        x = x + self.ffn(self.ln2(x))
        return x
```

## 4. 整机组装 + 权重共享

```python
class MiniGPT(nn.Module):
    def __init__(self, cfg):
        super().__init__()
        self.cfg = cfg
        self.tok_emb = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.pos_emb = nn.Embedding(cfg.block_size, cfg.d_model)  # 可学习绝对位置
        self.blocks = nn.ModuleList([Block(cfg) for _ in range(cfg.n_layer)])
        self.ln_f = nn.LayerNorm(cfg.d_model)
        self.head = nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)
        self.head.weight = self.tok_emb.weight   # weight tying：输入输出共享嵌入，省参数防过拟合

    def forward(self, idx, targets=None):        # idx: (B, T)
        T = idx.shape[1]
        x = self.tok_emb(idx) + self.pos_emb(torch.arange(T, device=idx.device))
        for blk in self.blocks: x = blk(x)
        x = self.ln_f(x)
        logits = self.head(x)                     # (B, T, vocab)
        loss = None
        if targets is not None:                   # 语言建模：预测"下一个" token
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.view(-1))
        return logits, loss
```

## 5. 训练与生成（复用 PyTorch 标准循环）

```python
def get_batch(data, block_size, batch=32):
    ix = torch.randint(0, len(data) - block_size - 1, (batch,))
    x = torch.stack([data[i:i+block_size] for i in ix])
    y = torch.stack([data[i+1:i+block_size+1] for i in ix])   # 目标 = 输入右移一位
    return x, y

model = MiniGPT(GPTConfig()).to('cuda')
opt = torch.optim.AdamW(model.parameters(), lr=3e-4)
for step in range(2000):
    x, y = get_batch(data, GPTConfig.block_size)
    x, y = x.to('cuda'), y.to('cuda')
    _, loss = model(x, y)
    opt.zero_grad(); loss.backward(); opt.step()   # 标准 PyTorch 五步
    if step % 200 == 0: print(step, loss.item())

@torch.no_grad()
def generate(model, idx, max_new=200, temperature=0.8, top_k=40):
    model.eval()
    for _ in range(max_new):
        idx_cond = idx[:, -model.cfg.block_size:]
        logits, _ = model(idx_cond)
        logits = logits[:, -1, :] / temperature     # 只取最后一个位置
        if top_k:                                    # top-k 采样防尾部长尾词
            v, _ = torch.topk(logits, top_k)
            logits[logits < v[:, [-1]]] = float('-inf')
        probs = F.softmax(logits, dim=-1)
        idx = torch.cat([idx, torch.multinomial(probs, 1)], dim=1)
    return idx
```

## 6. 常见坑清单

1. **mask 方向**：`triu(diagonal=1)` 是遮"未来"，遮反了 loss 不降；
2. **目标错位**：target 必须是输入右移一位（预测下一个，不是当前）；
3. **拆头维度**：view → transpose 顺序错了注意力算的是错位配对；
4. **LN 位置**：Pre-LN 是 `x + f(LN(x))`，写成 `LN(x + f(x))` 就是 Post-LN，小模型能训但深了不稳；
5. **eval/train 模式**：本实现无 dropout/BN 可忽略，但加上后忘切必炸。

## 7. 进阶练习（自测路线）

1. 给 generate 加 KV Cache（推理时缓存历史 K/V，只算新 token——对照 vLLM 笔记的 PagedAttention 思想）；
2. 把绝对位置换成 RoPE；
3. 换 SwiGLU FFN；
4. 跑通 nanoGPT 复现 Shakespeare（Karpathy 的成名教学项目，结构与此完全同构）。

## 8. 高频面试题

1. causal mask 怎么实现？（上三角填 -inf，softmax 前加上）
2. weight tying 是什么、为什么？（嵌入与输出头共享：省 V×d 参数、语义空间一致）
3. 推理为什么慢、KV Cache 为什么快？（自回归每步重算全部历史注意力 → 缓存 K/V 后每步 O(T·d)）
4. temperature / top-k / top-p 的作用？（控制采样随机性分布形状）

## 9. 参考资料

- [nanoGPT](https://github.com/karpathy/nanoGPT)
- [The Annotated Transformer](https://nlp.seas.harvard.edu/annotated-transformer/)
- [PyTorch Transformer 教程](https://pytorch.org/tutorials/beginner/transformer_tutorial.html)
