# 架构说明（公开版）

> 本文描述产品级数据流与模块边界，**不包含**完整 Prompt、评分权重、爬虫选择器与内部 MCP 编排细节。

## 核心链路

```mermaid
flowchart LR
  A[数据采集] --> B[清洗与对齐]
  B --> C[竞品工作台]
  C --> D[多维对比]
  D --> E[AI 评论与需求分析]
  E --> F[机会判断与报告]
  F --> G[导出与协作]
```

### 1. 数据采集

- **手工录入**：竞品名称、链接、外观/结构备注。
- **表格导入**：Excel / CSV 字段映射到统一 schema（演示版见 `demo/data/mock_workspace.json`）。
- **可选扩展**（未随仓库公开）：电商列表爬虫、第三方 MCP 类目数据等。

### 2. 清洗与对齐

- 链接去重、平台标签归一、HTML 实体与标签碎片剥离。
- 功能矩阵布尔字段与 AI 文本字段分离存储。
- **筛选下拉**仅做展示层清洗，不对 UTF-8 中文做编码「修复」（避免误伤）。

### 3. 竞品工作台

- 卡片式 CRUD、批量选择、筛选栏（状态 / 平台 / 类型 / 功能 / 标签 / 材质 / 价格）。
- 工作区持久化：浏览器 `localStorage` + `IndexedDB`（演示版为内存 + 可选导入 JSON）。

### 4. 多维对比

- 功能矩阵横向对照、价格/销量区间筛选、评价维度统计。
- 模块二看板：痛点 / 机会 / 差异结构化展示（公开版为静态 Mock）。

### 5. AI 评论与需求分析

- 用户自备 API Key，前端直连兼容 OpenAI / Anthropic / Gemini 等协议。
- 页面解析、字段补全、社媒摘录等为 **可选能力**；生产 Prompt 与字段校验规则未公开。

### 6. 机会判断与报告

- 聚合竞品结论 → 需求洞察 → 策略建议 → 可导出 Markdown / Excel。
- 「市场机会判断」为三表流水线输出之一（完整 pipeline 代码未随仓库发布）。

## 技术边界

| 层级 | 公开仓库 | 完整版（未公开） |
|------|----------|------------------|
| UI 壳层与筛选 | ✅ 演示 HTML | 全量 Tab / 主题 / 快捷键 |
| 数据模型 | ✅ Mock JSON | 完整字段与版本迁移 |
| AI 调用 | ❌ 仅占位 | Prompt 工程 + 重试 + 成本统计 |
| 爬虫 / MCP | ❌ | Playwright 选择器、SellerSprite 编排 |
| 三表 BI | ❌ 架构说明 | `side_table_pipeline` 等完整实现 |

## 数据模型（简化）

```text
Product
├── id, name, platform, link, review_links
├── appearance, structure, tags[]
├── functions: Record<FeatureName, true|false|null>
└── ai_results: Record<FieldKey, string|object>
```

## 安全与脱敏原则

1. 仓库内 **零** API Key、Cookie、真实商品 ID。
2. 示例链接统一 `example.com`。
3. 不包含 `.cursor/skills`、内部 MCP 配置与飞书/爬虫凭据。
4. 版权声明见根目录 `LICENSE`。

---

Copyright © 2026 刘星雨. All rights reserved.
