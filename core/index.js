#!/usr/bin/env node
// core/index.js — CLI 入口（agent-agnostic）
// 用法：
//   node core/index.js --input <spec.json|doc.md|"字符串"> --mode A --format both [--out ./out]
//   --mode A|B|C          目标消费模式（默认 A = MCP/Function Calling）
//   --format html|md|both 报告格式（默认 both）
//   --model-base-url / --model-api-key / --model-name   OpenAI-compatible 后端（可选，未给则语义规则标 NOT_TESTED）
//   --dynamic            开启动态膜（需配合 --dynamic-target）
//   --dynamic-target     JSON 字符串：{baseUrl, probePath, statusPath, headers}
import fs from 'node:fs';
import path from 'node:path';
import { loadInput } from './loaders/index.js';
import { review } from './engine.js';
import { MODES } from './schema.js';
import { getMode } from './modes.js';
import { toMarkdown } from './report/markdown.js';
import { toHtml } from './report/html.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`api-doc-reviewer — 审查 API 文档是否适合 AI agent 使用

用法：
  node core/index.js --input <文件|字符串> [选项]

选项：
  --input <path|string>       必填。OpenAPI JSON/YAML，或散文/markdown 文本
  --mode  A|B|C               目标消费模式（默认 A）
  --format html|md|both       报告格式（默认 both）
  --out   <dir>               输出目录（默认 ./review-out）
  --model-base-url <url>      OpenAI-compatible 端点（可选）
  --model-api-key  <key>      API key（可选）
  --model-name     <model>   模型名（默认 gpt-4o-mini）
  --dynamic                    开启动态膜（实测真实 API）
  --dynamic-target <json>     动态目标配置 {baseUrl,probePath,statusPath,headers}
  --help                       显示本帮助
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  const input = args.input;
  if (!input) { console.error('错误：缺少 --input'); printHelp(); process.exit(1); }

  const mode = (args.mode || 'A').toUpperCase();
  if (!MODES[mode]) { console.error(`错误：--mode 必须是 A/B/C，收到 ${mode}`); process.exit(1); }

  const format = (args.format || 'both').toLowerCase();
  if (!['html', 'md', 'both'].includes(format)) { console.error('错误：--format 必须是 html/md/both'); process.exit(1); }

  // 1) 加载
  let loaded;
  try {
    loaded = await loadInput(input);
  } catch (e) {
    console.error(`加载失败：${e.message}`);
    process.exit(1);
  }

  // 2) 构建 ctx
  const modeMeta = getMode(mode);
  const ctx = {
    kind: loaded.kind,
    doc: loaded.doc,
    meta: loaded.meta,
    mode,
    modeName: modeMeta.name,
    model: args['model-base-url'] || args['model-api-key']
      ? { base_url: args['model-base-url'], api_key: args['model-api-key'], model: args['model-name'] || 'gpt-4o-mini' }
      : undefined,
    dynamic: args.dynamic
      ? { enabled: true, target: safeParse(args['dynamic-target']) }
      : { enabled: false },
  };

  // 3) 审查
  const report = await review(ctx);

  // 4) 生成报告
  const outDir = args.out || path.join(process.cwd(), 'review-out');
  fs.mkdirSync(outDir, { recursive: true });
  const base = `api-doc-review-${mode}`;
  const written = [];
  if (format === 'md' || format === 'both') {
    const md = toMarkdown(report);
    const f = path.join(outDir, `${base}.md`);
    fs.writeFileSync(f, md, 'utf8');
    written.push(f);
  }
  if (format === 'html' || format === 'both') {
    const html = toHtml(report);
    const f = path.join(outDir, `${base}.html`);
    fs.writeFileSync(f, html, 'utf8');
    written.push(f);
  }

  // 5) 控制台摘要
  const s = report.summary;
  console.log(`\n✅ 审查完成（模式 ${mode} · ${modeMeta.name}）`);
  console.log(`   文档：${loaded.meta.title}（${loaded.kind === 'openapi' ? 'OpenAPI' : '散文'}）`);
  console.log(`   FAIL ${s.fail} ｜ WARNING ${s.warn} ｜ PASS ${s.pass} ｜ 严重 ${s.critical}`);
  console.log(`   未测 ${report.coverage.notTestedCount} 条（见报告覆盖声明）`);
  console.log(`   报告已写出：\n   - ${written.join('\n   - ')}\n`);
}

function safeParse(json) {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { console.warn('警告：--dynamic-target 不是合法 JSON，已忽略'); return undefined; }
}

main().catch((e) => { console.error('运行异常：', e); process.exit(1); });
