---
id: model-compression
title: 模型压缩（蒸馏 / INT8 量化）
category: 深度学习基础
layer: L1-算法底层
tags: [蒸馏, 量化, TinyBERT, DistilBERT, 边缘部署]
status: todo
links: [bert-series, vllm-deployment]
sources:
  - [DistilBERT 论文](https://arxiv.org/abs/1910.01108)
  - [TinyBERT 论文（两阶段蒸馏）](https://arxiv.org/abs/1909.10351)
---

# 模型压缩：蒸馏与 INT8（待学习）

> 一句话：让 BERT 类模型"变小变快"的两板斧——知识蒸馏（大模型当老师，软标签教小模型，DistilBERT 小 40% 快 60% 保留 97% 效果）与量化（INT8/动态量化，CPU 推理提速），服务高并发线上打分与边缘部署场景。

## 是什么 / 为什么值得学

- **知识蒸馏**：学生学老师的软概率分布（温度系数 T 放大类间关系）而不只是硬标签；TinyBERT 进一步蒸馏注意力矩阵与隐层（两层：预训练蒸馏 + 微调蒸馏）；
- **量化（INT8）**：训练后动态量化一行代码（`torch.quantization.quantize_dynamic`），CPU 上 BERT 推理显著提速、内存减半；
- 与 LLM 量化（GPTQ/AWQ，见关联 todo）的关系：同一思想不同技术路线——BERT 类整数量化简单稳定，生成式 LLM 要处理 KV Cache 与逐 token 解码；
- 简历场景对齐：政策分类线上高并发 → BERT 蒸馏/量化 = 低成本扩容方案。

## 学习路径

1. 读 DistilBERT 的蒸馏损失构造（软标签交叉熵 + 余弦相似度）；
2. 实操：政策分类 BERT 蒸馏成 6 层小模型 + INT8 动态量化，报精度/QPS/内存三指标对比；
3. 了解蒸馏在 LLM 时代的变体（白盒/黑盒蒸馏、DeepSeek 蒸馏 R1 到小模型）。

## 关键问题（学完应能回答）

- 软标签为什么比硬标签信息多？（类间相似度结构，"暗知识"）
- 蒸馏和微调的区别？（老师输出当目标 vs 人工标注当目标）

## 参考资料

- [DistilBERT](https://arxiv.org/abs/1910.01108)
- [TinyBERT](https://arxiv.org/abs/1909.10351)
