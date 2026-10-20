---
id: agent-workflow-skill
title: 工作流编排与 Skill 封装
category: Agent 系统
layer: L4-业务应用层
difficulty: 进阶
tags: [工作流编排, 低代码, Skill, Airflow, Agent平台]
status: learned
links: [openai-agent-sdk, genspark-search-agent]
sources:
  - [Apache Airflow 官方文档](https://airflow.apache.org/docs/apache-airflow/stable/)
  - [Manus Skills（官方：技能自动沉淀机制）](https://manus.im/blog/manus-skills)
---

# 工作流编排与 Skill 封装

> **一句话**：工作流（Workflow）= 预定义步骤的确定性管道；Skill = 把「提示词 + 工具 + 流程 + 知识库」打包成可复用、可配置的能力资产。简历场景：风云平台基于 Airflow 做工作流编排 + Skill 封装，实现**零代码配置**的智能体业务流程——让业务人员拖拖配置就能上线 AI 应用，是平台型产品的核心卖点。

## 1. 为什么平台需要"编排"（与自主 Agent 的关系）

- 自主 Agent（Manus 式）灵活但不可控、成本不可预估；纯 workflow 确定性强但不灵活——**平台级答案是分层**：
  - **80% 高频确定性场景** → 可视化工作流（低代码）：意图分类 → 检索 → 生成 → 后处理，节点可测试可回归；
  - **20% 开放复杂任务** → Agent 循环（LLM 自主决策工具调用）；
  - 这与 Genspark CTO 的建议完全一致（详见关联笔记），面试可以直接引用。

## 2. 工作流编排的核心设计（简历：基于 Airflow）

- **Airflow 的角色**：DAG（有向无环图）任务编排与调度——在平台里承接**数据/模型类定时管道**（知识库增量更新、评测集跑批、模型批量调用），LLM 业务链路则用自研轻量节点编排（低代码画布）；
- **典型 LLM 工作流节点**：输入/意图分类 → 查询改写 → 知识检索 → 重排 → 提示词组装 → LLM 生成 → 格式校验/内容安全 → 输出；每个节点可独立配置与测试；
- **工程要点**：节点幂等可重试、失败降级路径（检索挂了走兜底话术）、版本管理（流程改动可回滚）、运行日志与耗时/token 统计。

## 3. Skill 封装（把能力变成资产）

- 一个 Skill = 提示词模板 + 绑定的工具集 + 可选的固定子流程 + 引用的知识库，例如「政策匹配 Skill」= 政策专家提示词 + 检索工具 + 政策知识库；
- 对业务人员：像"安装应用"一样把 Skill 拼进自己的智能体（零代码的关键）；
- 对开发者：SKILL.md 式声明文件（Manus Skills 同款思路：模型分析成功交互后自动沉淀可复用技能），平台侧做统一注册、权限与计量；
- Skill 的复利：越用越多、越用越准（使用数据反哺评测与优化），是平台的护城河资产。

## 4. 高频面试题

1. 什么时候用 workflow，什么时候用 Agent？（确定性/可审计 → workflow；开放探索 → Agent；分层组合）
2. 低代码编排怎么兼顾灵活性？（节点可嵌套子流程/自定义代码节点/Skill 复用；复杂逻辑留 Agent 节点）
3. 工作流失败了怎么排查？（节点级日志、重试与降级、Tracing 链路）

## 5. 衍生学习

- Dify / Coze 类平台节点编排对比
- Airflow 与新型编排（Prefect、Dagster）差异
- Agent 编排标准（A2A 协议等）

## 6. 参考资料

- [Apache Airflow 文档](https://airflow.apache.org/docs/apache-airflow/stable/)
- [Manus Skills 官方博客](https://manus.im/blog/manus-skills)
