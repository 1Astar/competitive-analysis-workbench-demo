# 竞品分析工作台 · 公开演示版

> 面向硬件 / 消费电子 / 智能陪伴等品类的 **竞品信息采集 → 清洗对齐 → 多维对比 → AI 辅助分析 → 机会判断** 一体化工作台（演示仓库）。

[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

---

## 项目背景

产品经理与硬件团队在立项、选品、定价和功能规划阶段，需要频繁横向对比大量竞品，但信息分散在电商详情、评测文章、社媒笔记与内部表格中，难以形成可检索、可筛选、可汇报的结构化结论。

本工具将 **竞品卡片、功能矩阵、评价摘录、AI 字段补全、策略报告** 收敛到单页工作台，降低「Excel + 收藏夹 + 临时文档」的协作成本。

> **说明**：本仓库为 **脱敏公开版**，用于展示产品思路与交互范式；**不包含** 完整 Prompt、爬虫/MCP 编排、真实竞品数据或 API 密钥。

---

## 目标用户

| 角色 | 典型场景 |
|------|----------|
| 产品经理 | 竞品池维护、功能差异对照、机会点汇报 |
| 硬件 / 嵌入式 | 材质、结构、传感器能力横向表 |
| 市场 / 运营 | 价格带、卖点关键词、社媒舆情摘录 |
| 创始人 / 决策层 | 一键导出策略摘要与机会判断 |

---

## 核心流程

```text
数据采集 → 清洗对齐 → 多维对比 → AI 评论分析 → 机会判断 → 报告导出
```

1. **数据采集**：手工录入、表格导入、（完整版）链接解析 / 爬虫 / MCP  
2. **清洗对齐**：去重链接、剥离 HTML 碎片、功能矩阵布尔化、筛选选项展示层清洗  
3. **多维对比**：状态 / 平台 / 类型 / 功能 / 标签 / 材质 / 价格筛选  
4. **AI 分析**：用户自备 Key，补全核心功能、评价、需求点等（**生产 Prompt 未公开**）  
5. **机会判断**：聚合痛点与机会 → 策略模块 / 三表 BI（完整 pipeline 未公开）  
6. **导出**：工作区 JSON、Excel、Markdown 报告（演示版仅 Mock）

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 功能模块（公开 vs 完整版）

| 模块 | 演示仓库 | 完整版（未公开） |
|------|----------|------------------|
| 竞品工作台 & 筛选 | ✅ `demo/index.html` | 全量 Tab、批量 AI、IndexedDB |
| Mock 工作区数据 | ✅ `demo/data/mock_workspace.json` | 真实项目工作区 |
| 筛选文案清洗节选 | ✅ `demo/js/filter-utils.js` | 全链路清洗与导入规则 |
| AI 调用 & Prompt | ❌ | 多模型、页面解析、成本统计 |
| 爬虫 / MCP | ❌ | 淘宝列表、SellerSprite 等 |
| 三表 / 市场 BI | ❌ 架构说明 | `side_table_pipeline` 等 |

---

## 产品亮点

- **单页工作台**：竞品卡片 + 顶栏筛选 + 统计，减少上下文切换  
- **功能矩阵**：14+ 维度布尔对照，支持快速速筛  
- **AI 字段与手工字段并存**：解析结果可回写外观 / 链接，人工可覆盖  
- **策略报告结构化输出**：痛点 / 机会 / 差异分栏（演示版为 Mock 聚合）  
- **本地优先**：浏览器存储，适合内网与 `file://` 场景（演示建议本地 HTTP）

---

## 项目截图

> 截图为 **SVG 示意 + DEMO 水印**，非真实业务数据。可替换为自行录屏后上传 `assets/screenshots/*.png`。

| 工作台 | 材质筛选 |
|--------|----------|
| ![工作台](assets/screenshots/01-workspace.svg) | ![筛选](assets/screenshots/02-filters.svg) |

| 策略报告 |
|----------|
| ![报告](assets/screenshots/03-report.svg) |

---

## 演示视频 / GIF

- **交互演示**：本地打开 [`demo/index.html`](demo/index.html)，点击「导入 Mock 数据」，操作筛选与 Tab 切换  
- **录屏建议**：OBS / Win+G 录 30–60s，导出为 `assets/demo-flow.gif` 并在本段替换链接  
- **流程图**：README 上方 Mermaid 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 中的链路图

---

## 快速开始

### 方式 A：本地 HTTP（推荐，可加载 Mock JSON）

```bash
cd demo
python -m http.server 8765
# 浏览器打开 http://localhost:8765/
```

### 方式 B：直接打开 HTML

双击 `demo/index.html` 可能因浏览器 CORS 策略无法 `fetch` JSON；若失败请用方式 A。

### 导入数据

点击 **「导入 Mock 数据」**，或手动将 `demo/data/mock_workspace.json` 作为完整版工作区的导入样本（字段结构兼容 v3 导出格式）。

---

## 技术栈

| 类别 | 选型 |
|------|------|
| **前端** | 原生 HTML / CSS / JavaScript（单页，无构建链） |
| **表格** | SheetJS (`xlsx`) — 完整版内嵌，演示版未捆绑 |
| **导出** | Excel / Markdown / 工作区 JSON |
| **持久化** | `localStorage` + `IndexedDB`（完整版） |
| **AI** | 兼容 OpenAI / Anthropic / Gemini 等 HTTP API（用户自备 Key，演示版未接入） |
| **可选搜索** | Tavily 等（完整版，密钥不入库） |
| **后端 / DB** | **无** — 纯前端；不附带数据库文件 |
| **爬虫（未公开）** | Python + Playwright 示例在完整版 `爬虫/` 目录 |

---

## 仓库结构

```text
github-public/
├── README.md                 # 本文件
├── LICENSE                   # 著作权声明（非开源许可）
├── .gitignore
├── demo/
│   ├── index.html            # 可交互演示页
│   ├── data/mock_workspace.json
│   └── js/filter-utils.js    # 筛选清洗节选
├── docs/
│   └── ARCHITECTURE.md       # 设计思路与模块边界
└── assets/screenshots/       # 水印示意截图
```

---

## 脱敏与合规说明

本仓库 **刻意不包含**：

- 真实竞品名称、链接、销量、内部定价策略  
- API Key、Cookie、MCP / 飞书 / 爬虫凭据  
- 完整 AI Prompt、评分权重、机会判断公式  
- 生产用 `index.html`（约 2 万行）及三表 pipeline 源码  
- 任何数据库或 IndexedDB 快照文件  

如需商用、二次开发或获取完整版，请联系著作权人另行授权。

---

## 上传 GitHub 步骤

```bash
cd github-public
git init
git add .
git commit -m "chore: add desensitized public demo for competitive analysis workbench"
# 在 GitHub 新建空仓库后：
git remote add origin https://github.com/<your-user>/<repo>.git
git branch -M main
git push -u origin main
```

建议仓库描述：`Desensitized demo — competitive analysis workbench (PM toolkit)`  
建议 Topics：`product-management`, `competitive-analysis`, `demo`, `html`

---

## 版权声明

**Copyright © 2026 刘星雨. All rights reserved.**

未经许可不得复制、修改、商用或二次分发。详见 [LICENSE](LICENSE)。

---

## 作者

刘星雨 · AI 宠物 / 竞品分析方向产品经理
