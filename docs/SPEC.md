# Agent API 文档审查器 — 完整规格文档（Spec V1.0）

> 状态：待确认（确认后进入实现）· 语言：中文 · 格式：Markdown
> 来源：本规格 = 架构讨论结论 + 桌面 PRD《Agent_Readiness_Checker_PRD_V1.0》可取之处的融合。
> 维护约定：规则 ID 保持稳定；新增/调整检查项记录变更原因与适用前提；重大变更升版本号。

---

## 0. 文档摘要与来源说明

**一句话定位**：检查一份 API 文档是否适合 AI Agent 可靠使用，输出可复现的证据 + 可执行的修改方案（不打分、只给修改意见）。

**本规格与桌面 PRD 的关系**：
- PRD 是一份**产品级检查器**规格，覆盖「MCP Server / RAG 检索系统 / 在线文档」**三类目标**，共 136 候选规则 + 状态机 + 数据模型 + 安全边界。
- 本产品的聚焦点更窄：**审查「API 文档」本身**——以文档视角评估它能否被 Agent 以三种模式消费，并可选做「动态膜」实测真实 API。
- 因此本规格**采纳 PRD 的工业级治理与设计**（状态枚举、严重度、适用性、规则元数据、报告结构、安全边界等），并把 PRD 的 136 项**按 ID 映射进我们的七层×三模式框架**；同时保留我们的原创增量（元结构、动态探针库、双端、模型可移植）。
- **不采纳** PRD 的「重产品架构」：Web UI / 多租户 / Credentials Vault 后端。我们交付更轻——`core` CLI/库 + Skill 端（完整）+ Chrome 扩展端（SPEC）。

---

## 1. 产品定位与边界

### 1.1 一句话定位
输入一份 API 文档，跑一遍，给出「这份文档作为 Agent 工具/知识源是否合格」的审查报告 + 可勾选修改点。

### 1.2 输入（全部支持）
- OpenAPI / Swagger JSON（规则引擎完美发挥）
- 任意 markdown / HTML 文档文件
- docs 站点 URL（Skill 端由 agent server 侧 fetch；扩展端由 DOM 抓取）

### 1.3 输出（全部给）
- HTML 信息图（report-ready，便于汇报）
- Markdown 报告（便于 diff / 进仓库）

### 1.4 三种目标消费模式（选不同类型 → 出不同报告）
| 模式 | 含义 | 我们的主线？ |
|---|---|---|
| **A — MCP / Function Calling** | 把文档变成工具的入参，agent 像调函数 | 是（默认重点） |
| **B — RAG 检索** | 文档喂进知识库，agent 现查现用 | 可选 |
| **C — Agent 浏览器读文档** | agent 像人一样打开 docs 站点读 | 可选 |

一份文档可只跑一种，也可一次跑三种出三份报告（或一份合并视图，每层按模式给结论）。

### 1.5 边界（共识，来自 PRD §1.2 + 我们的讨论）
- **不打综合分数、不分级**。按严重程度 + 证据组织报告。
- **静态膜与动态膜严格分离**；不适用 ≠ 失败，未测试 ≠ 通过。
- 不默认探测生产环境写权限，不做自动修改线上代码（先给可执行建议）。
- 不把 `llms.txt` / Markdown / 工具数量上限误认为跨平台强制规范（属可选增强）。
- 覆盖声明：只提供检索 API 不宣称检查了索引覆盖；只提供文档 URL 不宣称验证了后台 API 行为。

---

## 2. 核心架构（双端 + 共享核心）

### 2.1 可移植单位 = `core + rubric + prompt`，不是 `.skill` 文件
```
                    ┌─────────────────────────────┐
                    │   Core 审查引擎（agent-agnostic） │
                    │  · 规则引擎（零模型，两端复用）     │
                    │  · 七层×三模式 检查调度           │
                    │  · 三层发现 schema              │
                    │  · 报告模板（HTML / md）         │
                    └───────────────┬───────────────┘
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
   ┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
   │ 模型后端（可插拔）   │   │ Agent / 端 适配器（薄封装） │   │ 动态膜探针             │
   │ OpenAI-compatible │   │ WorkBuddy .skill       │   │ 实测真实 API          │
   │ 协议（默认）       │   │ Claude/Cursor/Trae shim│   │ （可选，需测试凭据）    │
   │ base_url 可配      │   │ 任意能 shell out 的 agent│   │                      │
   │ ·OpenAI           │   │ Chrome 扩展（SPEC）     │   │                      │
   │ ·PT（同协议）      │   │                        │   │                      │
   │ ·DeepSeek/Ollama  │   └──────────────────────┘   └──────────────────────┘
   │ ▶ Agent-hosted 模式│
   │  宿主 agent 自判语义 │
   └──────────────────┘
```

### 2.2 模型后端（采纳用户决策：默认 OpenAI-compatible）
- **默认协议 = OpenAI-compatible**（不是默认锁定 OpenAI 厂商），`base_url` 可配。
- 同协议端点皆可：OpenAI、PowerTokens（换 `base_url` 即用）、DeepSeek、通义、本地 Ollama/vLLM。
- **Agent-hosted 模式**：宿主 agent 回路里已有模型时，由宿主 agent 做语义判断，core 只给结构与规则——零外部 LLM 依赖，是「适配任何 agent/模型」最彻底的形态。
- 规则引擎（L1/L3 精检、L4 查缺、动态断言主体）全程零模型、确定性强、可重复。

### 2.3 双端交付
| 端 | 形态 | 输入获取 | 模型访问 | 动态膜 | 输出 |
|---|---|---|---|---|---|
| **Skill 端** | agent 内直接接入（完整实现） | 文件 / URL 参数（干净） | agent 回路，免费、已在回路 | server 侧直调，无 CORS | 报告文件 HTML/md |
| **Chrome 扩展端** | 读文档时内联审查（**只写 SPEC，不写代码**） | DOM 抓取 + OpenAPI JSON | 自调 LLM → OpenAI-compatible（默认） | 须 background worker 绕 CORS | 内联高亮 + 侧栏 + 导出 md |

- 扩展端 v1 建议先做 OpenAPI 页面（规则引擎快赢）；散文文档（需通用 DOM 提取器）延后。
- 两端差异只在「获取层」；语义判断逻辑（抽 schema、判清晰度、生成修复文案）共享核心。

---

## 3. 元结构：七层 × 三层发现 × 两层膜

### 3.1 七层框架（L0–L6）
| 层 | 名称 | 关注点 | 定义 |
|---|---|---|---|
| L0 | 形态层 | 机器/agent 能否读到 | 文档形态、可访问性、可被解析/抓取 |
| L1 | 结构层 | schema 是否完整 | 参数类型/必填/枚举/嵌套、命名一致 |
| L2 | 语义层 | 讲清没讲清「何时用」 | 用途、前置条件、字段歧义、同义表述 |
| L3 | 契约层 | 怎么调、出什么 | 认证、请求/响应 example、错误码、status 枚举 |
| L4 | 行为层 | agent 最容易出事故处 | 幂等/重试、副作用分级、分页游标、限流退避、异步轮询 |
| L5 | 安全层 | 高危与越权 | 破坏性操作确认、危险示例警示、PII/租户隔离、注入隔离 |
| L6 | 生命周期 | 变更可追溯 | deprecated 标注、版本/changelog、可发现性 |

### 3.2 三层发现（每条 finding 的骨架）
> **检查什么 → 不符合的后果 → 应该如何修改**（带 before / after 片段）

### 3.3 两层膜
| 膜 | 含义 | 是否可选 |
|---|---|---|
| **静态膜** | 只看文档本身（spec 解析 / 文本判断） | 必跑 |
| **动态膜** | 实测真实 API（发请求、比对契约、验证行为） | 可选（需测试凭据/沙箱） |

动态膜护栏（详见 §5 / §10）。

### 3.4 状态枚举（采纳 PRD §2，应用到每条 finding）
`PASS` / `FAIL` / `WARNING` / `NOT_APPLICABLE` / `NOT_TESTED` / `ERROR`
- `ERROR` = 检测器自身异常，必须区别于被测服务失败。
- `NOT_TESTED` ≠ `PASS`；缺凭据/环境/样本时只能标 `NOT_TESTED`。

### 3.5 严重程度（采纳 PRD §2，基于实际影响+证据，非评分）
严重（越权/泄露/重复扣款）> 高（阻断主要任务）> 中（高概率误用或缺失重要信息）> 低（效率与可维护性）。

### 3.6 适用性（采纳 PRD §2，对应我们的「硬检/重点/顺带/不查」）
| 等级 | 含义 | 对应我们讨论 |
|---|---|---|
| Required（必检） | 该模式基本运行前提 | 硬检 |
| Conditional（条件适用） | 有对应功能才查（如写幂等、版本管理） | 重点/顺带中按需 |
| Recommended（建议） | 提升可用性，缺失不直接判违规（如 llms.txt） | 顺带 |
| N/A | 目标无该功能或不满足前提 | 不查 |

---

## 4. 检测内容总览（七层 × 三模式 × 两层膜）

### 4.1 检查强度矩阵（每层 × 每模式）
| 层 | A(MCP/FC) | B(RAG) | C(浏览器读) |
|---|---|---|---|
| L0 形态 | 顺带 | 顺带 | **重点** |
| L1 结构 | **硬检** | 顺带 | 不查 |
| L2 语义 | **重点** | **重点** | **重点** |
| L3 契约 | **重点** | 顺带 | **重点** |
| L4 行为 | **硬检** | 顺带 | 不查 |
| L5 安全 | **重点** | 顺带 | 顺带 |
| L6 生命周期 | 顺带 | **重点** | 顺带 |

- 对 OpenAPI 输入：L1/L3/L4 走**规则引擎确定性校验**；对散文/URL 走**模型层语义判断**（确定性弱，报告中标注）。
- 硬检/重点项缺了，agent 会直接踩坑；顺带项是体验加分。

### 4.2 PRD 136 项 → 七层映射（按 ID 引用，原三列内容保留）
> PRD §4/§5/§6 的 136 条（静态 82 + 动态 54）原样采纳为详细 rubric；下表定义它们如何落进我们的七层。详细三列内容（检查什么/后果/改法）以 PRD 原文为准，本规格不重复粘贴。

| 我们的层 | A 模式来源（PRD MCP 模块） | B 模式来源（PRD RAG 模块） | C 模式来源（PRD Docs 模块） |
|---|---|---|---|
| **L0 形态** | M-S01（协议传输） | R-S01..R-S08（解析/噪声/标题/Chunk/表/代码/图） | D-S01..D-S18, D-S30（URL/HTML/JS/登录/robots/llms.txt/md/导航/目录/标题/噪音） |
| **L1 结构** | M-S06（命名）, M-S11..M-S13（inputSchema/约束/依赖互斥） | R-S04..R-S07（分块/独立理解/表/代码） | D-S19, D-S20（API 用途/参数文档） |
| **L2 语义** | M-S07..M-S10（描述/边界/重叠/数量组织）, M-S15,M-S16（输出清晰） | R-S05（独立理解）, R-S16（语义检索） | D-S15,D-S16,D-S17,D-S19,D-S25（术语/指代/警告/前置条件） |
| **L3 契约** | M-S05（认证）, M-S15,M-S16（输出）, M-S17,M-S18（错误表达/可修复） | R-S15,R-S20（来源/无结果语义） | D-S21,D-S22,D-S23,D-S24（响应/示例/认证/错误码） |
| **L4 行为** | M-S20（分页）, M-S21（状态可查）, M-S22（风险标注）, M-S26（幂等）, M-S27（限流重试）, M-S28（长任务）, M-S23,M-S24（高危确认/最小权限） | — | D-S25,D-S26,D-S27（前置/顺序/端到端）, D-S28（文档/API 一致） |
| **L5 安全** | M-S22,M-S23,M-S24,M-S25（注入）, M-S29（敏感信息） | R-S23（租户隔离） | D-S17,D-S30（警告/注入与密钥） |
| **L6 生命周期** | M-S03（Capabilities 声明） | R-S10,R-S12,R-S13（更新/版本/去重） | D-S29（版本/changelog） |

动态膜（PRD §4.2 / §5.2 / §6.2 的 54 项）：M-D01..M-D17、R-D01..R-D18、D-D01..D-D19——原样采纳为「动态评测测试集」的生成来源（见 §5.3）。

### 4.3 我们的原创补充（PRD 未覆盖，写入 rubric）
- **L4 行为层 agent 事故高发区**的显式检查项（PRD MCP 已含 M-S20..M-S28，本规格在其上强调「文档必须写出，而非靠 agent 猜」）：
  - 幂等键是否写明（POST 建资源能否安全重试）
  - 副作用分级是否标注（读/写/破坏性）
  - 分页 cursor vs offset + 是否有 total
  - 429/5xx 是否区分退避策略
  - 长任务状态查询机制（polling vs callback）
- **三层发现强制 before/after 片段**（PRD 改法列是文字，本规格要求可复制的改前/改后 diff）。
- **覆盖声明**写入每份报告（PRD §8 已含，本规格设为强制首节）。

---

## 5. 动态膜设计（实测真实 API）

### 5.1 可选前提
- 用户给**测试凭据 / 沙箱地址**才跑；无凭据时只跑静态膜，报告标注「以下项需实测才能定论」。

### 5.2 护栏（采纳 PRD §11，应用到动态膜）
1. 默认**只读**；任何写入测试需明确授权 + 允许动作清单 + 受限凭据 + 沙箱。
2. 默认禁止真实支付/删除/发信/大规模修改；需评估时用模拟/沙箱状态。
3. 限定 SSRF / URL 探测范围，阻止内网元数据与未授权地址；限制重定向/域名/IP。
4. 所有外部文档、RAG 片段、工具返回均视为**不可信数据**，不当作系统指令。
5. 限速、并发限制、紧急中止开关、最大成本上限。
6. 凭据单独安全存储（扩展端存 `chrome.storage`，需告知用户）；报告脱敏，日志限时。

### 5.3 测试集 schema（采纳 PRD §7.2，YAML 示例）
```yaml
id: API-CASE-001
module: mcp            # 或 rag / docs
objective: "创建订单后查询其状态，不得重复创建"
environment: sandbox
allowed_actions: [create_order, get_order_status]
forbidden_actions: [delete_order, pay]
expected:
  status_enum_in_doc_matches_actual: true
  idempotent_on_retry: true
limits:
  max_requests: 10
  max_tokens: 10000
  cost_budget: 0.05
```

### 5.4 动态评测原则（采纳 PRD §7.2）
- 固定测试集：正例、反例、边界、无答案、失效授权、超时/限流、跨步骤。
- **分层归因**：检索失败 / 工具选择失败 / 参数失败 / 服务失败 / 模型理解失败 分别记录。
- **避免仅凭另一个 LLM 主观打分**；尽量用 Schema 断言、预期文档 ID、沙箱状态变更等可验证断言。
- 多次采样识别随机性；不缺样本数不报「成功率」。

### 5.5 动态膜探针库（我们的原创，来自 PT 视频 skill 踩坑档案 A/B 层）
> 这 14 条是「文档不可信、必须实测」的活证据，直接变成本 skill 的测试集种子。

| 探针 | 来源坑 | 映射层 | 验证什么 |
|---|---|---|---|
| status 枚举实测比对 | 坑01（文档写 `succeeded`，网关返 `completed`） | L3 | 文档枚举 = 真实返回值，agent 不能精确匹配文档词 |
| 非 200 / 字段缺失返回 | 坑02/12（status 变空串→静默空转） | L4 | 文档必须写清「非 200 / 缺字段时返回什么」 |
| 限流 vs 服务器错误区分 | 坑03/13（429 与 5xx 共用阈值误杀） | L4 | 文档须区分可恢复/不可恢复，给不同退避 |
| 错误码语义唯一 | 坑04（403 同时承载余额不足/无权/Key失效） | L3 | 每个错误码必须写清代表什么 |
| 鉴权失败码 | 坑05（无效 Key 返 500+token_invalid，非 401） | L3 | 拿假 Key 实测失败码，不假设 401 |
| 参数真实约束 | 坑10（只收 http URL、不识占位符） | L1 | 参数真实约束要写清，否则提交才失败 |
| 能力边界/超时归属 | 坑06/07/09 | L2/L5 | 文档讲清能力边界；拿不到真值标「未知」而非瞎编 |
| 多路兜底判定 | B-11 | L4 | 失败分类决定重试/放弃 |
| 读不出状态要熔断 | B-12 | L4 | 卡住先只读查状态，不盲目重提 |
| 可恢复错误分开 | B-13 | L4 | 退避策略按错误类型分 |
| 卡住先只读查状态 | B-14 | L4 | `status <task_id>` 思路：先查再决定 |

---

## 6. 报告规范（不打分）

### 6.1 报告结构（采纳 PRD §8，强制首节=覆盖声明）
1. **基本信息**：项目、模式、目标、环境、执行时间、协议/服务版本。
2. **覆盖声明（强制）**：跑了哪些静态规则/动态任务；未跑原因；不可见的系统内部信息。
3. **问题总览**：按严重程度排序，可按层/静态-动态筛选；可显问题个数，无综合评分。
4. **问题详情**：三列表格（检查什么 / 不符合后果 / 怎么改），每条带 `before/after` 片段 + 状态 + 严重度 + 适用性。
5. **证据**：响应片段、Schema 路径、文档 URL 与锚点、调用轨迹、可复现步骤。
6. **复测差异**（如有）：修复/新增/未解决/无法复测。

### 6.2 单条 finding JSON schema（采纳 PRD §8.2，扩展 before/after）
```json
{
  "issue_id": "ISSUE-1042",
  "rule_id": "M-S12",
  "mode": "A",
  "layer": "L1",
  "phase": "static",
  "status": "FAIL",
  "severity": "HIGH",
  "applicability": "REQUIRED",
  "check": "工具 search_orders 的 status 参数缺少枚举约束",
  "consequence": "Agent 可能填入服务端不接受的订单状态，导致连续调用失败",
  "fix": "在 inputSchema.status 中声明合法 enum 并说明含义",
  "before": "status: { type: string }",
  "after": "status: { type: string, enum: [pending, paid, shipped, completed] }",
  "evidence": [{"type": "schema_path", "location": "tools.search_orders.inputSchema.properties.status"}],
  "auto_judgable": true,
  "retest": "PENDING"
}
```

### 6.3 证据治理（采纳 PRD §8，应用到所有端）
默认脱敏 Key / Token / 邮箱 / 个人数据；仅存最小必要片段；报告不携带明文秘钥。

### 6.4 双输出
- **HTML 信息图**：report-ready，分层拆解 + 对比表 + 覆盖声明，便于汇报。
- **Markdown**：便于 diff / 进仓库 / 跨 agent 读取。

---

## 7. 核心数据模型（agent-agnostic，可移植关键）

> 采纳 PRD §10.2。这是「可移植单位」的数据骨架——任何 agent 调 core 都围绕这些实体。

| 实体 | 关键字段 |
|---|---|
| Project | id, name, owner, modes, created_at |
| Target | id, project_id, type(openapi/markdown/url), endpoint, version, access_profile |
| Rule | rule_id, mode, layer, phase, applicability, check, consequence, fix, auto_judgable, severity_default, version |
| TestCase | id, mode, goal, input, expected_assertions, limits, allowed_actions, forbidden_actions |
| Run | id, target_id, mode, environment, agent_version, started_at, status |
| Finding | id, run_id, rule_id, mode, layer, status, severity, consequence, remediation, before, after |
| Evidence | id, finding_id, type, uri/path, redaction_level, hash |
| TraceStep | id, run_id, step, action, input_ref, output_ref, duration |
| RetestDiff | baseline_run_id, new_run_id, fixed/new/unchanged/not_tested |

---

## 8. 双端交付细节

### 8.1 Skill 端（完整实现）
- 输入：文件路径 / URL + `--mode A|B|C` + `--format html|md|both`。
- 内部：调 `core` CLI → 规则引擎（零模型）+ 模型层（agent 回路或独立 OpenAI-compatible）。
- 跨 agent shim 模板（仓库内置）：`skills/workbuddy/`、`skills/claude/`、`skills/cursor/`、`skills/trae/`——各写薄封装调同一 `core`。

### 8.2 Chrome 扩展端（只写 SPEC，不写代码）
接口契约（SPEC 必含）：
- 扩展喂 core 什么：归一化输入（OpenAPI JSON，或抽取后的散文文本）。
- core 返回什么：`Finding[]` + 报告（§6 schema）。
- 两难点解法：① CORS → background service worker 调 core/API（不受页面源限制）；② DOM 提取 → 通用提取器 + per-site 适配器。
- 模型调用：OpenAI-compatible endpoint（默认），auth header 可配。
- 骨架：最小 `manifest.json`（activeTab/storage/host_permissions）+ background worker 示例代码 + 隐私说明（PT/OpenAI key 存 `chrome.storage` 非加密，文档内容会发到模型后端，须告知用户）。
- 上架：Web Store 需写隐私说明。

---

## 9. GitHub 交付与可移植性

### 9.1 repo 布局（建议）
```
agent-api-doc-reviewer/
  core/                 # agent-agnostic CLI + 规则引擎 + 数据模型 + 报告模板
    src/
    rules/              # 七层×三模式 rubric（采纳 PRD 136 项 + 我们增量）
    probes/             # 动态膜探针库（PT 踩坑档案 14 条 + PRD 动态 54 项种子）
  skills/
    workbuddy/          # .skill 薄封装
    claude/             # shim 模板
    cursor/             # shim 模板
    trae/               # shim 模板
  extension-notes/      # Chrome 扩展 SPEC（接口契约 + 骨架 + 难点）
  README.md
  LICENSE               # MIT（建议）
```

### 9.2 可移植性来源
- `core` 是标准可执行（CLI/库），不绑 WorkBuddy；`.skill` 只是 WorkBuddy 一端之壳。
- 模型层 OpenAI-compatible 默认 + Agent-hosted 模式 → 任何 agent/模型可用。
- 真正跨平台单位 = `core + rubric + prompt`，非 `.skill` 文件。

### 9.3 待定（写代码前定）
- **core 语言**：Node/TS（agent/IDE 中 node 普及率高，推荐）vs Python（环境有 3.13，但非所有 agent 保证有）。
- **LICENSE**：MIT（推荐）。
- 扩展 v1 范围：仅 OpenAPI 页面（推荐）还是连散文。

---

## 10. 安全与权限（采纳 PRD §11，全产品适用）

1. 默认只读；写入测试需明确授权 + 允许清单 + 受限凭据 + 沙箱。
2. 默认禁止真实支付/删除/发信/大规模修改；用模拟/沙箱状态。
3. 限定 SSRF / URL 探测；阻止内网元数据与未授权地址。
4. 外部文档/RAG 片段/工具返回 = 不可信数据，不当系统指令。
5. 限速、并发限制、紧急中止、最大成本上限。
6. 凭据单独安全存储；报告脱敏；日志限时保留。
7. 仅获授权后做安全/越权测试，不主动访问第三方隐私数据。

---

## 11. 实施阶段（MVP 范围）

### Phase 1 — MVP（P0，立即可用）
- `core` + 规则引擎（零模型）+ Mode A 静态检查（OpenAPI 精检 L1/L3/L4）。
- 三层发现报告 + 覆盖声明 + HTML/md 双输出。
- Skill 端薄封装（WorkBuddy）。

### Phase 2 — 完整 V1（P1）
- Mode B / C 静态；动态膜（探针库 + 测试集 + 护栏）。
- 模型层（OpenAI-compatible 默认 + Agent-hosted 模式）。
- 跨 agent shim 模板（Claude/Cursor/Trae）；扩展端 SPEC 定稿。

### Phase 3 — 规模化（P2）
- 扩展端代码实现（OpenAPI 页面先行）。
- 用户自定义规则/测试集；版本变化回归；复测差异。

---

## 12. 采纳 PRD 决策对照表

| PRD 设计 | 本规格处理 |
|---|---|
| 三列结构（check→consequence→fix） | 采纳，并强制 before/after 片段 |
| 无综合评分 | 采纳 |
| 静态/动态分离 + 不适用≠失败/未测≠通过 | 采纳为两层膜治理 |
| 状态枚举 6 态 | 采纳 |
| 严重度 4 级 | 采纳 |
| 适用性 Required/Conditional/Recommended/N/A | 采纳（对应硬检/重点/顺带/不查） |
| 规则元数据 schema | 采纳 |
| 136 检查项 | 采纳，按 ID 映射进七层×三模式 |
| 报告含覆盖声明 | 采纳为强制首节 |
| 证据脱敏 | 采纳 |
| 动态评测（固定集/分层归因/避免LLM主观打分） | 采纳 |
| 安全护栏（§11） | 采纳为动态膜护栏 |
| 数据实体（§10.2） | 采纳为核心数据模型 |
| Web UI / 多租户 / Credentials Vault | **不采纳**（交付更轻：core CLI + skill + 扩展 SPEC） |
| MCP/RAG 系统当独立在线评测目标 | **不采纳为独立产品**；以「文档视角」评估 + 可选动态膜实测 |

---

## 13. 待用户最终确认项

1. core 语言：Node/TS（推荐）还是 Python？
2. LICENSE：MIT（推荐）？
3. 扩展 v1 范围：仅 OpenAPI 页面（推荐）还是连散文？
4. 确认后是否按 Phase 1（core + 规则引擎 + Mode A 静态 + Skill 端）进入实现？

> 确认后，下一步将：实现 `core` CLI + 规则引擎 + Mode A 静态检查 + 报告模板 + WorkBuddy `.skill` 薄封装（Phase 1），并产出首份可运行的自测报告。
