# WebMCP tools (dev only)

Pages can register typed tools that a browser agent (Claude Code through
Chrome DevTools MCP) calls instead of reading the accessibility tree and
clicking. Based on
[Setting up WebMCP for Claude Code and Chrome DevTools MCP](https://dalenguyen.me/blog/2026-09-25-webmcp-agent-driven-chrome).

## What is registered

| Page      | Tool                | Does                                                                   |
| --------- | ------------------- | ---------------------------------------------------------------------- |
| `/events` | `events_list_state` | Both lists as JSON: title, path, start time, `hasMore` per list        |
| `/events` | `events_load_more`  | `{ list: 'upcoming' \| 'past', all?: boolean }`, pages like the button |

Code lives in `apps/web/src/app/webmcp/`:

- `web-mcp.ts`: `registerWebMcpTools()`. Registers only in dev mode and in a
  browser with the API. Unregisters when the host component is destroyed. A
  thrown handler answers `{ ok: false, error }`.
- `events-page-web-mcp.directive.ts`: the `/events` tools. The page only adds
  `appEventsPageWebMcp` to its `<main>`. The directive injects the page and
  uses its public API, so the page holds no tool code.

Add a page: write a directive that injects the page (or component) and calls
`registerWebMcpTools()`. Put it on one element of that page's template.

## Set up Chrome DevTools MCP with the flag

WebMCP needs `--enable-features=WebMCP` on the Chrome that the MCP server
drives. Chrome reads it only at startup.

```sh
claude mcp add chrome-devtools-webmcp -- npx chrome-devtools-mcp@latest \
  --isolated --chrome-arg=--enable-features=WebMCP
```

Restart Claude Code. `--isolated` avoids the "browser is already running for
.../chrome-profile" error when another session holds the default profile.

## Call a tool from `evaluate_script`

Chrome 153 API (it changed since the blog post): `registerTool()` returns a
promise, `executeTool()` takes a tool object from `getTools()` and a JSON
string, and returns a JSON string. The poll covers the gap before Angular
hydrates and registers.

```js
async () => {
  const mc = document.modelContext;
  for (let i = 0; i < 50; i++) {
    const t = (await mc.getTools()).find((t) => t.name === 'events_list_state');
    if (t) return JSON.parse(await mc.executeTool(t, '{}'));
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('tool not registered');
};
```

## Before vs after

Task: list every upcoming and past event on `/events`, and say whether both
lists are fully loaded (14 upcoming, 8 past). Measured through a real
`chrome-devtools-mcp` server; average of 3 runs. Tokens ≈ response chars / 4.
Reproduce with `node apps/web/scripts/webmcp-compare.mjs`.

| Approach                                  | MCP calls | Tokens into context | Wall time |
| ----------------------------------------- | --------: | ------------------: | --------: |
| Before: `wait_for` + `take_snapshot`      |         3 |              ~8,300 |    ~0.8 s |
| Before: `evaluate_script` + DOM selectors |         2 |                ~610 |    ~1.0 s |
| After: `evaluate_script` + WebMCP tool    |         2 |                ~835 |    ~0.9 s |

What this shows:

1. **Snapshot vs tool: ~10x fewer tokens.** `wait_for` and `take_snapshot`
   each return the full a11y tree (~16 KB for this page).
2. **Hand-written DOM script vs tool: about equal.** The tool returns a bit
   more because it includes `startsAt`. The DOM script was only this small
   because its selectors were written from the source code. An agent without
   that knowledge first takes a snapshot (~4,100 tokens) to learn the DOM.
3. **Errors.** A bad input gets the app's own message:
   `{"ok":false,"error":"list must be \"upcoming\" or \"past\", got nope"}`.
   A DOM script that misses a selector returns empty arrays, which look like
   "no events".
4. **Stability.** The tool survives markup and class changes. The DOM script
   breaks on the first layout refactor (`main > div > div.grid`).

## Limits

- Dev builds only. Tools run with the page's authority and no auth check.
- The directive ships in the production bundle but does nothing there.
- The API is experimental: expect its shape to change again.
- A tool proves state, not visuals. Still take a screenshot for layout checks.
- No registration-form tool yet: every public event is external, so no page
  renders that form without writing test data to production.
