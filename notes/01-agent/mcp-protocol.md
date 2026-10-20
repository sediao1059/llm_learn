---
id: mcp-protocol
title: MCP（Model Context Protocol）
category: Agent 系统
layer: L3-应用工程层
path: 5.3
difficulty: 入门
tags: [MCP, 工具协议, 生态, Function-Call]
status: todo
links: [function-call, openai-agent-sdk]
sources:
  - [MCP 官方文档](https://modelcontextprotocol.io/)
  - [MCP 官方规范（GitHub）](https://github.com/modelcontextprotocol/modelcontextprotocol)
---

# MCP 协议生态（待学习）

> 一句话：MCP 是 Anthropic 发起的"工具/上下文接入 USB-C 标准"——统一声明工具、资源、提示词的协议，客户端一次接入即可获得整个生态的 Server，解决 M×N 工具集成变成 M+N 的问题；Function Call 是模型侧能力，MCP 是工具侧生态。

## 是什么 / 为什么值得学

- 核心概念：MCP Server 暴露 **Tools**（可调用函数）、**Resources**（可读数据）、**Prompts**（模板）；Host（如 Claude/Agent 工作台）通过标准协议发现与调用；
- 传输：stdio（本地进程）与 Streamable HTTP（远程服务）两种形态；
- 价值：工具一次封装、处处可用（公司内部把政策检索/问数/工单系统封装成 MCP Server，任何支持 MCP 的客户端直接用）——智能体平台工具生态的标准答案；
- 也要知道争议面：无状态设计的局限、鉴权与企业管控仍在演进。

## 学习路径

1. 读官方文档的协议握手与工具发现流程（initialize / tools/list / tools/call）；
2. 实操：把一个内部能力（如政策检索 API）封装成 MCP Server，挂到 Agent SDK 的工具列表里跑通；
3. 调研生态：常见 MCP Server（数据库、浏览器、文件系统）与平台如何做注册/权限/计量。

## 关键问题（学完应能回答）

- MCP 与 Function Call 的关系？（模型能力 vs 工具接入标准，互补层次）
- 企业内网落地的治理要点？（Server 白名单、鉴权审计、敏感工具分级）

## 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP 规范仓库](https://github.com/modelcontextprotocol/modelcontextprotocol)
