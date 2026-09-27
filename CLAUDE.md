<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Browser testing

- Always test in the browser with the `chrome-devtools-webmcp` MCP server, not `chrome-devtools`. It runs Chrome with `--enable-features=WebMCP`. Setup and the call snippet: `docs/webmcp.md`.
- Call the page's WebMCP tools (`document.modelContext`) through `evaluate_script` before you use `take_snapshot`, `click` or `fill`. One tool call returns small JSON; a snapshot returns the full a11y tree (~10x more tokens).
- When a test needs a page state or an action that has no tool, add a tool for it. Use a directive in `apps/web/src/app/webmcp/` that injects the page and calls `registerWebMcpTools()`. Add a spec. Do not put tool logic in the page itself.
- Tools are dev-only and never write to production data (the dev server uses the real Firestore).
- Still take a screenshot for layout and visual checks. A tool proves state, not visuals.
