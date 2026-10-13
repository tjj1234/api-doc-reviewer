# api-doc-reviewer

审查 API 文档是否**适合 AI agent 使用**——在把文档转成 MCP tool / 喂进 RAG / 让 agent 浏览器读之前，先揪出 agent 会踩的坑，产出「检查什么 → 不符合的后果 → 应该如何修改」的修改意见报告（HTML + Markdown）。

> 不是打分器，是**修改清单生成器**。每条发现都带「agent 怎么踩」和「改成什么样」（before/after）。

## 为什么需要它
- 你丢一份只有散文的 API 文档给 agent 当 MCP tool，agent 不知道参数类型和必填项 → 调用全失败。
- 文档有 OpenAPI，但没写「POST 建订单不幂等、不能重试」→ agent 超时重试把订单建了三遍。
- 本工具在「让 agent 用之前」把这些坑先揪出来。

## 核心设计
- **七层框架**：L0 形态 → L1 结构 → L2 语义 → L3 契约 → L4 行为 → L5 安全 → L6 生命周期（越往下越贴 agent 特有盲区）。
- **三种消费模式**（一份文档可出不同报告）：
  - `A` MCP / Function Calling（最看重 L1 结构 + L4 行为）
  - `B` RAG 检索（最看重 L2 语义 + L6 可发现）
  - `C` Agent 浏览器读文档（最看重 L0 形态 + L3 页面示例）
- **两层膜**：
  - 静态膜：只看文档本身（规则引擎 / 模型语义判断）
  - 动态膜（可选）：实测真实 API，验证「文档写的 ≠ 网关真实行为」（探针种子来自 PT 视频 skill 踩坑档案）
- **三层发现**：检查什么 → 不符合的后果 → 应该如何修改。
- **状态机**：PASS / FAIL / WARNING / NOT_APPLICABLE / NOT_TESTED / ERROR。报告**首节即覆盖声明**——未测≠通过，不适用≠失败。

## 可移植性（重点）
可移植单位是 **`core` + rubric + prompt`，不是 `.skill` 文件**：
- `core/` 是 agent-agnostic 的 Node CLI/库，**任何 agent/IDE 都能直接调**。
- 模型后端默认 **OpenAI-compatible 协议**（世界语），不锁定厂商；PT 网关 `https://api.powertokens.ai/v1` 兼容，指向即可。
- 支持 **Agent-hosted 模式**：宿主 agent 回路里已有模型时，core 只跑规则引擎，零外部 LLM 依赖。

## 网页版（免安装，浏览器里跑）

不想装 Node？直接打开网页版，粘贴内容 / 上传文件 / 输入网址即可审查：

**https://tjj1234.github.io/api-doc-reviewer-web/** （仓库：[api-doc-reviewer-web](https://github.com/tjj1234/api-doc-reviewer-web)）

同一份 `core` 引擎，纯前端运行，文档不上传服务器。网页版跑的是**静态膜**（只看文档本身），动态膜受浏览器跨域限制不可用 —— 相关项会在报告首节的覆盖声明里明确标为「未测」，不冒充通过。需要完整两层膜请用下面的命令行版本。

## 快速开始
```bash
npm install
# 审查一份 OpenAPI（模式 A，产出 HTML + MD）
node core/index.js --input ./examples/bad-openapi.json --mode A --format both
# 散文/URL：先把页面内容 fetch 成文件再传入
node core/index.js --input ./doc.md --mode B --format both
# 开启动态膜（需测试凭据/沙箱）
node core/index.js --input spec.json --mode A --dynamic \
  --dynamic-target '{"baseUrl":"https://api.example.com","probePath":"/v1/models","statusPath":"/v1/tasks/{id}","headers":{"Authorization":"Bearer TEST_KEY"}}'
```

## 目录结构
```
api-doc-reviewer/
├── core/                 # 可移植核心（任何 agent/IDE 可调用）
│   ├── index.js          # CLI 入口
│   ├── engine.js         # 审查编排
│   ├── schema.js         # 状态/严重度/适用性/七层/三模式常量
│   ├── modes.js          # 模式过滤
│   ├── loaders/          # OpenAPI(JSON/YAML) + 散文 加载
│   ├── rules/            # L0–L6 七层规则（每条带适用性/膜/check/consequence/fix）
│   ├── model/backend.js  # OpenAI-compatible 模型后端（可选）
│   ├── dynamic/          # 动态膜探针 + PT 踩坑测试集种子
│   └── report/           # HTML + Markdown 报告
├── skills/workbuddy/     # WorkBuddy 薄适配 SKILL.md
├── extension-notes/      # Chrome 扩展构建 SPEC
├── docs/                 # 完整设计规格
│   └── SPEC.md           # 七层×三模式×两膜 + 检测全项映射 + 动态探针库
├── examples/             # 样例（含故意有缺陷的 bad-openapi.json）
├── LICENSE
└── README.md
```

## 设计文档
完整设计规格见 [`docs/SPEC.md`](docs/SPEC.md)：七层框架 × 三消费模式 × 两层膜的元结构、七层×三模式检查强度矩阵、与桌面 PRD 的采纳对照、动态膜探针库（含 PT 视频 skill 踩坑档案 A/B 层 14 条种子）、报告规范、数据模型、双端（Skill + Chrome 扩展）与 GitHub 跨 agent 交付布局。

## License
MIT
