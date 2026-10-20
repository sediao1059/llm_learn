# graph — LLM 学习知识图谱

把 `../notes/` 里的学习笔记渲染成可交互的知识图谱：节点按分类着色，点击节点在右侧面板阅读笔记全文，`links` 生成节点连线，`status: todo` 的笔记（衍生学习坑位）以半透明虚线节点显示。

## 使用

```bash
# 1. 构建（notes/ 有变动后执行）
npm run build          # 等价于 node build.mjs

# 2. 查看（二选一）
open index.html        # 直接用浏览器打开（ECharts/marked 走 CDN，需联网）
npm run serve          # 或启动本地服务后访问 http://127.0.0.1:8080
```

## 交互

- 节点可拖拽，滚轮/双指缩放，空白处拖动平移
- 顶栏搜索框：按标题 / 标签 / 分类 / id 过滤，未命中的节点淡出
- 点击节点 → 右侧显示笔记正文（Markdown 渲染）、关联知识点（可点击跳转）、参考资料
- 图例（左上角）可按分类显隐节点

## 技术说明

- **零依赖构建**：`build.mjs` 只用 Node 内置模块，扫描 `notes/**/*.md`，解析 frontmatter，输出 `data/knowledge.js`（以 `window.KNOWLEDGE_DATA` 挂载，因此无需本地服务器、双击 `index.html` 即可用）
- 渲染：ECharts 5（force 力导向图）+ marked（Markdown），均从 CDN 加载；断网时图区会给出提示
- 构建产物 `data/knowledge.js` 随仓库提交，克隆后无需构建即可直接打开
