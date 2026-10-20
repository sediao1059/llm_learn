# graph — LLM 学习知识图谱

把 `../notes/` 里的学习笔记渲染成可交互的知识图谱：节点按分类着色，点击节点在右侧面板阅读笔记全文，`links` 生成节点连线，`status: todo` 的笔记（衍生学习坑位）以半透明虚线节点显示。

自带一个零依赖本地服务（Node 内置 `node:http` + `node:sqlite`），提供**注册/登录**和**按用户的知识点学习程度标注**（存 SQLite）。

## 使用

```bash
# 1. 构建图谱数据（notes/ 有变动后执行）
npm run build          # 等价于 node build.mjs

# 2. 启动本地服务（静态托管 + 登录 + 学习进度 API）
npm start              # http://127.0.0.1:8080
```

- 需要 Node ≥ 22.13（用到内置 `node:sqlite`，无第三方依赖）
- 直接双击 `index.html` 也能看图谱（离线只读模式：不能登录/标注，CDN 需联网）

## 交互

- 节点可拖拽，滚轮/双指缩放，空白处拖动平移；顶栏搜索按标题/标签过滤
- 点击节点 → 右侧显示笔记正文（Markdown 渲染）、**学习程度**标注、关联知识点（可点击跳转）、参考资料
- 右侧面板右上角 **⛶ 放大查看**：全屏阅读模式，支持 **A− / A＋ 字号调节**，Esc 或 ✕ 关闭
- 学习程度四档：**未学习 / 了解 / 熟悉 / 掌握**；标注后：
  - 节点外圈颜色按程度着色（灰 → 蓝 → 绿 → 金）
  - 顶栏统计"已学 x/y（掌握度 %）"
  - 每个用户的进度相互独立，保存在 `data/app.db`（SQLite，已 gitignore）
- 注册即自动登录；登录态（Bearer Token）存 localStorage，**永久有效**（仅退出登录时失效），刷新自动恢复

## API 一览（server.mjs）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | 注册（用户名 2–20 字符，密码 ≥ 4 位），返回 token |
| POST | /api/auth/login | 登录，返回 token |
| POST | /api/auth/logout | 退出（需 Bearer token） |
| GET | /api/auth/me | 当前登录用户 |
| GET | /api/progress | 我全部知识点的学习程度 |
| PUT | /api/progress | 标注 `{nodeId, level(0–3)}` |

密码使用 scrypt 加盐哈希存储，会话 token 存 SQLite。

## 技术说明

- **零依赖**：构建脚本和服务只用 Node 内置模块；渲染用 ECharts 5（force 力导向图）+ marked（Markdown），均从 CDN 加载
- `build.mjs` 扫描 `notes/**/*.md` 解析 frontmatter，输出 `data/knowledge.js`（挂到 `window.KNOWLEDGE_DATA`，双击 index.html 也能用）
- 构建产物 `data/knowledge.js` 随仓库提交，克隆后无需构建即可直接打开；`data/app.db` 是本地数据库，不入库
