# Chrome 扩展注意事项（SPEC，非完整实现）

本目录是 **api-doc-reviewer** 双端的「另一端」——Chrome 扩展的构建指南与最小骨架。
扩展端是「边读文档边挑刺」的无代码入口（对应你踩坑档案里「同事不会代码也能用」的精神），
但它是**最难、最不便携**的一块（DOM 抓取 / CORS / 权限 / 上架），故先以 SPEC 沉淀，核心复用 `../core`。

> 设计前提：可移植单位是 `core + rubric + prompt`，扩展只是把文档喂给 core 的薄适配。

## 1. 架构（与 Skill 端共享 core）

```
content script  ──抓取渲染后 DOM──▶  归一化文本/OpenAPI JSON
                                        │
background worker ──调用──▶  ../core (规则引擎 / 模型后端 / 动态膜)
                                        │
       side panel  ◀── 报告 HTML/MD ───┘
```

- **content script**：活在 docs 页面里，只负责**抓取**（不调外部 API，避开 CORS）。
- **background service worker**：唯一能发外部请求的上下文，**动态膜实测走这里**（不受页面源限制）。
- **core**：用 `<all_urls>` 权限把 `../core` 作为扩展内脚本引入，或直接 `import` 规则引擎模块调用 `review()`。

## 2. 两个难点与解法

### 2.1 CORS（动态膜实测）
- 扩展在 `docs.stripe.com` 页面里直调 `api.powertokens.ai` 会被浏览器拦。
- **解法**：所有真实 API 调用（动态膜探针、模型后端）放 background worker 发，content script 只与 background 通过 `chrome.runtime.sendMessage` 通信。
- 模型后端：走 OpenAI-compatible 端点（默认 OpenAI，可换 PT `https://api.powertokens.ai/v1`），请求从 background 发出。

### 2.2 DOM 抓取健壮性（扩展最难的一块）
- 每个文档站结构不同；通用提取器或 per-site 适配器。
- **v1 范围建议**：先做 **OpenAPI 页面**——站点通常暴露 OpenAPI JSON（Swagger UI 的 `/swagger.json`、Redoc 的 `x-schema`、或 `<script type="application/json">` 里的 spec），content script 直接拿到喂 core，规则引擎完美发挥。
- 散文文档站：需通用 DOM 提取器（标题层级 + 主内容区 + 代码块），这恰好是它要审的 L0 层问题，自己先克服。**v1 可暂缓，先做 OpenAPI 快赢。**

## 3. 最小 manifest（MV3）

```json
{
  "manifest_version": 3,
  "name": "API Doc Agent Readiness",
  "version": "0.1.0",
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }
  ]
}
```

- `host_permissions: ["<all_urls>"]` 是为了在任意 docs 站抓取与发请求；上架需在隐私说明里写清用途。

## 4. 隐私（必须告知用户）
- 模型后端调用会把**文档内容**发到配置的 LLM 端点（默认 OpenAI，或用户指定的 PT 网关）。
- API key 存 `chrome.storage`（非加密存储），需明确提示。
- 动态膜若启用，仅用测试 key，绝不上传生产凭据。

## 5. 最小 background.js 骨架（示意，非跑通）

```js
import { review } from '../core/engine.js';
import { loadInput } from '../core/loaders/index.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'REVIEW') {
    (async () => {
      const loaded = await loadInput(msg.text); // content script 已抓好的文本/JSON
      const report = await review({
        kind: loaded.kind, doc: loaded.doc, meta: loaded.meta,
        mode: msg.mode || 'A',
        model: msg.model,            // { base_url, api_key, model } OpenAI-compatible
        dynamic: { enabled: !!msg.dynamic, target: msg.dynamicTarget },
      });
      sendResponse({ html: toHtml(report), md: toMarkdown(report) });
    })();
    return true; // 异步响应
  }
});
```

## 6. 与 Skill 端的差异小结
| 维度 | Skill 端 | 扩展端 |
| --- | --- | --- |
| 输入获取 | 文件/URL 参数（agent server 侧 fetch） | DOM 抓取 + OpenAPI JSON |
| 模型 | 白嫖 agent 回路 / OpenAI-compatible | background 调 OpenAI-compatible |
| 动态膜 | server 侧直调无 CORS | background worker 绕 CORS |
| 输出 | 报告文件 | 侧栏内联 + 导出 md |
| v1 范围 | OpenAPI + 散文都支持 | 先做 OpenAPI 页面（快赢） |

> 想贡献扩展实现？按上面骨架补 `content.js` / `popup.html` / `background.js`，core 与 rubric 直接复用，无需重写规则。
