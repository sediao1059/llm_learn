---
id: uie-extraction
title: 信息抽取进阶（UIE / NER 微调 / 句法深入）
category: NLP 算法
layer: L1-算法底层
difficulty: 进阶
tags: [UIE, 信息抽取, NER, 依存句法, 序列标注]
status: todo
links: [hanlp-text-analysis, bert-series, llm-finetuning]
sources:
  - [UIE 论文（统一信息抽取）](https://arxiv.org/abs/2203.12277)
  - [PaddleNLP UIE 信息抽取最佳实践](https://github.com/PaddlePaddle/PaddleNLP/tree/develop/applications/information_extraction)
---

# 信息抽取进阶：UIE / NER 微调 / 句法深入（待学习）

> 一句话：把简历里 HanLP 规则抽取升级到模型化抽取的完整知识面——经典序列标注（NER）微调、UIE 统一抽取范式（一个模型抽实体/关系/事件/schema 自定义）、以及 LLM 抽取与小模型上线的取舍，外加依存句法/语义角色的深入补课。

## 是什么 / 为什么值得学

- **经典 NER 微调**：BERT + CRF/线性层序列标注（BIO），垂类实体（政策要素：金额/行业/资质）标注几百条即可微调，毫秒级线上；
- **UIE**：清华/百度提出的统一抽取范式——把实体/关系/事件都化为"Span 抽取"，通过 Schema-Prompt 自定义抽取目标，零样本冷启动 + 少样本微调，PaddleNLP 工业化最好；
- **LLM 抽取**：few-shot 定义新 schema 最灵活，但高并发贵 → 生产最优解 = LLM 冷启动造标注 → UIE/BERT 小模型上线（与政策垂类 GLM 微调路线同构）；
- 句法深入：依存句法树与语义角色标注（SRL）用于条件结构解析（政策"对谁、在什么条件下、给什么"），规则引擎（Drools 类）承接匹配计算。

## 学习路径

1. 补课：序列标注 BIO/BILOU、CRF 层的作用（标签转移约束）；
2. 实操：PaddleNLP UIE 用政策文本微调，抽取"对象/条件/支持内容"三要素，评 F1；
3. 对比实验：同一任务 LLM few-shot vs UIE 微调的精度/成本/QPS 三列对比表（面试武器）；
4. 进阶：依存句法解析政策条件句（"若…则…"结构识别）。

## 关键问题（学完应能回答）

- UIE 与传统 NER 模型的本质区别？（schema 可插拔的统一 prompt 式抽取 vs 固定标签集序列标注）
- 抽取结果怎么质检？（规则校验 + 双模型交叉 + 人工抽检 + 置信度过滤）

## 参考资料

- [UIE: Universal Information Extraction](https://arxiv.org/abs/2203.12277)
- [PaddleNLP 信息抽取](https://github.com/PaddlePaddle/PaddleNLP/tree/develop/applications/information_extraction)
