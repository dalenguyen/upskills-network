/**
 * Before/after WebMCP, measured through a real Chrome DevTools MCP server.
 *
 * Task: "list every upcoming and past event on /events and say whether both
 * lists are fully loaded", done three ways, three runs each:
 *
 *   before-snapshot  navigate, wait_for, take_snapshot (the default agent loop)
 *   before-dom       navigate, evaluate_script with hand-written selectors
 *   after-webmcp     navigate, evaluate_script calling events_list_state
 *
 * It counts the characters each MCP response puts into the agent's context
 * (tokens ~ chars / 4). Needs the dev server on :4200 and a Chrome started with
 * --enable-features=WebMCP --remote-debugging-port=9333. See docs/webmcp.md.
 *
 * Run: node apps/web/scripts/webmcp-compare.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT ?? 'tmp/webmcp-compare';
mkdirSync(OUT, { recursive: true });
const BROWSER = process.env.BROWSER_URL ?? 'http://127.0.0.1:9333';
const srv = spawn(
  'npx',
  [
    '-y',
    'chrome-devtools-mcp@latest',
    '--browserUrl',
    BROWSER,
    '--no-usage-statistics',
  ],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
let buf = '';
const waiting = new Map();
let id = 0;
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    }
  }
});
const rpc = (method, params) =>
  new Promise((r) => {
    const n = ++id;
    waiting.set(n, r);
    srv.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n',
    );
  });
const log = [];
async function tool(approach, name, args) {
  const t0 = Date.now();
  const res = await rpc('tools/call', { name, arguments: args });
  const text = (res.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  const entry = {
    approach,
    tool: name,
    chars: text.length,
    tokens: Math.ceil(text.length / 4),
    ms: Date.now() - t0,
    isError: !!res.result?.isError,
  };
  log.push(entry);
  return text;
}
const URL = process.env.PAGE_URL ?? 'http://localhost:4200/events';
const CALL = (name) => `async () => {
  const mc = document.modelContext;
  for (let i = 0; i < 50; i++) {
    const t = (await mc.getTools()).find(t => t.name === '${name}');
    if (t) return JSON.parse(await mc.executeTool(t, '{}'));
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('tool ${name} not registered');
}`;
await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'compare', version: '1' },
});
srv.stdin.write(
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) +
    '\n',
);
const np = await tool('setup', 'new_page', { url: 'about:blank' });
const pageId = Number(
  /(\d+):\s*about:blank/.exec(np)?.[1] ?? /pageId\D*(\d+)/i.exec(np)?.[1],
);
const results = {};
// Task: "List every upcoming and past event (title + path) and confirm both lists are fully loaded."
for (let run = 1; run <= 3; run++) {
  // BEFORE A: a11y snapshot (the default agent loop)
  await tool('before-snapshot', 'navigate_page', {
    pageId,
    type: 'url',
    url: URL,
  });
  await tool('before-snapshot', 'wait_for', { pageId, text: ['Past events'] });
  const snap = await tool('before-snapshot', 'take_snapshot', { pageId });
  if (run === 1) writeFileSync(OUT + '/snapshot-sample.txt', snap);
  // BEFORE B: hand-written DOM scripting
  await tool('before-dom', 'navigate_page', { pageId, type: 'url', url: URL });
  const dom = await tool('before-dom', 'evaluate_script', {
    pageId,
    function: `async () => {
    for (let i = 0; i < 50 && !document.querySelector('[aria-labelledby=past-events-heading]'); i++) await new Promise(r => setTimeout(r, 100));
    const read = root => [...(root?.querySelectorAll('app-event-card') ?? [])].map(c => ({ title: c.querySelector('h3,h2')?.textContent?.trim(), path: c.querySelector('a')?.getAttribute('href') }));
    const past = document.querySelector('[aria-labelledby=past-events-heading]');
    const buttons = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
    return { upcoming: read(document.querySelector('main > div > div.grid')), past: read(past), moreUpcoming: buttons.includes('Load more'), morePast: buttons.includes('Load more past events') };
  }`,
  });
  if (run === 1) writeFileSync(OUT + '/dom-sample.txt', dom);
  // AFTER: WebMCP tool
  await tool('after-webmcp', 'navigate_page', {
    pageId,
    type: 'url',
    url: URL,
  });
  const out = await tool('after-webmcp', 'evaluate_script', {
    pageId,
    function: CALL('events_list_state'),
    waitForStableDom: false,
  });
  if (run === 1) writeFileSync(OUT + '/webmcp-sample.txt', out);
}
writeFileSync(OUT + '/compare-log.json', JSON.stringify(log, null, 1));
const agg = {};
for (const e of log.filter((e) => e.approach !== 'setup')) {
  const a = (agg[e.approach] ??= {
    calls: 0,
    chars: 0,
    tokens: 0,
    ms: 0,
    errors: 0,
  });
  a.calls++;
  a.chars += e.chars;
  a.tokens += e.tokens;
  a.ms += e.ms;
  a.errors += e.isError;
}
for (const a of Object.values(agg))
  for (const k of Object.keys(a)) a[k] = +(a[k] / 3).toFixed(1);
console.log('per run (avg of 3):');
console.table(agg);
srv.kill();
process.exit(0);
