---
name: api-doc-reviewer
description: 审查 API 文档是否适合 AI agent 使用（MCP / RAG / 浏览器三种消费模式），产出「检查什么 → 不符合的后果 → 应该如何修改」的修改意见报告（HTML + Markdown）。当用户说"审查这份 API 文档/OpenAPI""这份接口文档 agent 能用吗""帮我看看文档适不适合给 agent/转成 MCP tool""给文档做 agent 体检"时触发。输入支持 OpenAPI JSON/YAML 与任意 markdown/散文；可选开启动态膜实测真实 API。
version: 1.0.0
author: A-Ban (WorkBuddy)
triggers:
  - 审查 API 文档
  - 文档适不适合给 agent
  - 转成 MCP tool 前体检
  - agent readiness check
---

# API 文档 Agent 可用性审查器（WorkBuddy 薄封装）

本 skill 是 `../core`（agent-agnostic 规则引擎 CLI）在 WorkBuddy 上的薄适配。**真正的审查逻辑全在 core，任何 agent/IDE 都能直接调这份 core**，WorkBuddy 只是把用户的文档接进去并呈现报告。

## 何时用
用户丢来一份 API 文档（OpenAPI / Swagger / 任意 docs 站点内容 / markdown），想确认「这份文档能不能让 agent 好好用」，或想在「转成 MCP tool / 喂进 RAG / 让 agent 浏览器读」之前先揪坑。

## 流程（直接动手，别停在说明）
1. **取文档**
   - 若是本地文件 / 用户贴的字符串：直接用路径或内容。
   - 若是 URL（如 docs 站点）：用你的 web 工具 fetch 页面**正文**，保存为 `.md`/`.txt` 再传入（core 不联网抓取）。
2. **定模式**（问一句或按默认）：
   - `A` = MCP / Function Calling（默认，最贴 PT/WorkBuddy 主线）
   - `B` = RAG 检索
   - `C` = Agent 浏览器读文档
3. **跑 core**（用受管 node）：
   ```
   node <repo>/core/index.js --input <文件或字符串> --mode A --format both --out <输出目录>
   ```
   - 散文/URL 场景若想让 core 做语义判断，传 `--model-base-url/--model-api-key/--model-name`（OpenAI-compatible；PT 网关 `https://api.powertokens.ai/v1` 也可，把 base_url 指过去即可）。不传则语义类规则标 NOT_TESTED（绝不伪造结论）。
   - **动态膜**（可选）：加 `--dynamic --dynamic-target '<json>'`，json = `{"baseUrl":"...","probePath":"/v1/models","statusPath":"/v1/tasks/{id}","headers":{"Authorization":"Bearer <测试key>"}}`。默认关闭；写操作/复杂编排探针按护栏不自动执行。
4. **呈现报告**：读出 `api-doc-review-<mode>.html` 与 `.md`，把关键 FAIL/WARNING 与「覆盖声明」讲给用户——**重点强调未测项不是通过**。
5. **给修改建议**：报告每条发现已含「检查什么 / 后果 / 修改」，直接照念 + 按 before/after 帮用户改文档。

## 边界（务必守住）
- 动态膜只用**测试 key / 沙箱**，绝不拿生产凭据；只读探测优先；不扣费；fail-open。
- 不往消息渠道发用户文档里的敏感信息；报告本身也不落盘敏感内容。
- 审查范围 = 用户给的这份文档，不自行扩到别的站点。
- 结论先行：先报 FAIL/WARNING 数量与最严重项，再展开。

## 适配其他 agent（复用同一份 core）
- Claude / Cursor / Trae：各自写薄 shim 调同一 `core/index.js` 即可，rubric 与 finding schema 完全通用。
- Chrome 扩展：见仓库 `extension-notes/README.md`，模型后端同样走 OpenAI-compatible。
