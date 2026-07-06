# Vercel 部署指南（公开 Demo 版）

本仓库 **仅部署静态 Mock Demo**，不包含 AI Prompt、评分规则、完整数据处理逻辑或数据库。

---

## 部署架构

```text
浏览器  →  Vercel CDN  →  demo/index.html + mock JSON/JS
                ↑
           无 Serverless / 无数据库 / 无环境变量（Demo 阶段）
```

| 放在前端（本 Demo） | 不放在前端（完整版 / 私有） |
|---------------------|---------------------------|
| Mock 竞品卡片、筛选 UI | AI Prompt、评分权重 |
| 展示层 HTML 清洗节选 | 三表 pipeline、爬虫选择器 |
| 虚构 `example.com` 链接 | 真实工作区、IndexedDB 快照 |
| 策略报告 Mock 拼接 | Tavily / 模型调用逻辑 |

---

## 一键部署

### 方式 A：Vercel Dashboard

1. 登录 [vercel.com](https://vercel.com)，**Import Git Repository**
2. 选择本仓库（建议 **仅你个人账号** 有权限，勿把公司/外人加为 Member）
3. 配置：
   - **Framework Preset**：Other
   - **Root Directory**：留空（使用仓库根目录）
   - **Build Command**：留空
   - **Output Directory**：`demo`（或由根目录 `vercel.json` 自动指定）
4. **Environment Variables**：**留空**（Demo 不需要任何变量）
5. Deploy

### 方式 B：Vercel CLI

```bash
cd github-public
npm i -g vercel
vercel login
vercel --prod
```

首次会询问项目设置，Build / Output 均选默认；`vercel.json` 已指定 `outputDirectory: demo`。

---

## 环境变量与安全

### 当前 Demo：**不需要**环境变量

静态页 + 内置 `mock-embed.js`，不发起任何带密钥的请求。

### 若将来在私有仓库增加 AI 代理 API

| 变量 | 存放位置 | 说明 |
|------|----------|------|
| `OPENAI_API_KEY` | Vercel → Settings → Environment Variables | **仅** Serverless / Route Handler 读取 |
| `DATABASE_URL` | 同上 | 仅服务端，禁止写进前端 |
| `NEXT_PUBLIC_*` | 会打进浏览器 JS | **切勿**用于 API Key / DB 连接串 |

Next.js 官方说明：`NEXT_PUBLIC_` 前缀的变量会在构建时嵌入客户端 bundle，任何人可在 DevTools 中看到。

**推荐模式**（完整版，非本 Demo）：

```text
浏览器  →  POST /api/analyze  →  Vercel Function  →  读取 process.env.OPENAI_API_KEY  →  上游模型
```

Prompt 模板、评分规则放在 **服务端代码或私有 Git 子模块**，不要 `import` 进 Client Component。

### Vercel 项目权限

- 能访问 Vercel 项目的人 **可能看到** Environment Variables 配置界面
- Demo 项目：**不要配置任何密钥**
- 生产项目：仅本人 / 必要协作者；勿邀请无关账号

---

## 仓库内文件说明

| 文件 | 作用 |
|------|------|
| `vercel.json` | 静态输出目录 `demo`、安全响应头 |
| `package.json` | 标识项目，无 build 脚本 |
| `.env.example` | 文档用途，列出「完整版才需要」的变量名 |
| `.vercelignore` | 部署时忽略 scripts 等 |
| `demo/data/mock-embed.js` | 内置 Mock，Vercel 上无需 fetch 也能加载 |

---

## 部署后验证

1. 打开 `https://<your-project>.vercel.app/`
2. 应看到 3 条虚构竞品（AlphaBot / PetPal / EchoDino）
3. 筛选、Tab 切换正常
4. 浏览器 Network：**无** 对外部 AI API 的请求
5. 查看页面源码：**无** `sk-` / `tvly-` 等密钥字符串

---

## 自定义域名（可选）

Vercel → Project → Settings → Domains → 添加域名并按提示配置 DNS。

---

Copyright © 2026 刘星雨. All rights reserved.
