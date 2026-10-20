---
id: pytorch-basics
title: PyTorch 核心基础
category: 深度学习基础
tags: [PyTorch, Tensor, autograd, 训练循环, nn.Module]
status: learned
links: [llm-finetuning, bert-series, transformer-architecture]
sources:
  - [PyTorch 官方 Tutorials（60 Minute Blitz 起步）](https://pytorch.org/tutorials/)
  - [HuggingFace Transformers（基于 PyTorch 生态）](https://huggingface.co/docs/transformers)
---

# PyTorch 核心基础

> **一句话**：PyTorch = **Tensor（多维数组 + GPU 加速）+ autograd（自动微分）+ nn（神经网络组件）** 三件套，定义前向、自动求梯度、写个训练循环就能训模型。它是 BERT 微调、LoRA 微调、vLLM 生态的底层语言——简历里的微调实践全部站在它上面。

## 1. 三大件

```python
import torch
import torch.nn as nn

# ① Tensor：像 NumPy，但能上 GPU、能追踪梯度
x = torch.randn(32, 768, device="cuda")          # batch=32, 特征=768

# ② autograd：记录计算图，backward 自动算梯度
w = nn.Linear(768, 2)                             # ③ nn.Module：可训练层的容器

logits = w(x)                                     # 前向
loss = nn.functional.cross_entropy(logits, y)
loss.backward()                                   # 反向：自动求 ∂loss/∂θ
optimizer.step(); optimizer.zero_grad()           # 更新参数、清梯度
```

## 2. 万物皆此模板：标准训练循环（背下来）

```python
for epoch in range(EPOCHS):
    for xb, yb in DataLoader(dataset, batch_size=32, shuffle=True):
        xb, yb = xb.to(device), yb.to(device)
        pred = model(xb)            # 1. 前向
        loss = loss_fn(pred, yb)    # 2. 算损失
        optimizer.zero_grad()       # 3. 清旧梯度
        loss.backward()             # 4. 反向传播
        optimizer.step()            # 5. 更新权重
    model.eval()                    # 评估模式（关 dropout/固定 BN）
    with torch.no_grad():           # 评估不吃显存梯度
        ...
```

- `model.train()` / `model.eval()`：切换 dropout、BatchNorm 行为（忘切是新手第一大 bug）；
- `torch.no_grad()`：推理时不建计算图，省显存提速；
- 混合精度（`autocast` + fp16）：大模型训练标配，显存减半速度翻倍。

## 3. 微调场景直接相关的能力

| 能力 | 在微调里的角色 |
|---|---|
| `nn.Parameter` / `requires_grad` | LoRA 的本质：冻结基座参数（requires_grad=False），只让旁路 BA 可训练 |
| `state_dict()` | 保存/加载权重；LoRA 权重单独存取、合并（W += BA） |
| DataLoader / Dataset | 构造指令微调样本流（instruction/input/output） |
| `to(device)`、显存管理 | OOM 排查第一步：张量/模型都要上同一设备 |
| HuggingFace transformers | 在 PyTorch 之上封装了 BERT/GLM 的加载与训练（AutoModelForSequenceClassification…），LoRA 用 PEFT 库一行挂旁路 |

## 4. 与 TensorFlow 的一句话对比（面试常问）

PyTorch 动态图（define-by-run，像写 Python）调试直观、研究界与开源模型生态（HuggingFace、vLLM、PEFT）几乎全在 PyTorch——这也是选它的现实理由；TF 静态图部署历史优势已随 ONNX/TorchScript、vLLM 生态淡化。

## 5. 高频面试题

1. backward 的原理？（前向记录计算图，反向沿图链式法则自动求导）
2. `zero_grad` 为什么必须？（梯度默认累加，不清零会把上一 batch 的梯度加进来）
3. train/eval 模式区别？（dropout 随机/关闭、BN 用 batch 统计/滑动平均）
4. CUDA out of memory 怎么办？（减 batch、混合精度、梯度累积、量化、清理中间变量 del+empty_cache）

## 6. 衍生学习

- Transformer 的 PyTorch 手写实现（attention → encoder）
- 分布式训练（DDP、DeepSpeed ZeRO）
- torch.compile 与性能优化

## 7. 参考资料

- [PyTorch Tutorials](https://pytorch.org/tutorials/)
- [HuggingFace Transformers](https://huggingface.co/docs/transformers)
