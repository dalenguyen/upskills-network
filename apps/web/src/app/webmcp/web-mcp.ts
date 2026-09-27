import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  InjectionToken,
  PLATFORM_ID,
  inject,
  isDevMode,
} from '@angular/core';

/**
 * WebMCP tools: typed actions a page hands to a browser agent.
 *
 * An agent that drives Chrome (Claude Code through Chrome DevTools MCP, say)
 * normally reaches a page state by reading the accessibility tree, clicking and
 * typing, then reading the tree again to see what happened. A registered tool
 * replaces that loop with one call that returns structured JSON, and it answers
 * with the app's own validation messages instead of "element not found".
 *
 * ## Development builds only
 *
 * A tool runs with the page's full authority and no extra check: whoever can
 * call it can do what the handler does. So tools register only in dev mode,
 * never in a production bundle, and only in a browser that exposes the API
 * (Chrome launched with `--enable-features=WebMCP`). Everywhere else this is a
 * no-op.
 *
 * ## The API is experimental
 *
 * It has already moved from `navigator.modelContext` to
 * `document.modelContext`, and `registerTool` now returns a promise and
 * unregisters through an `AbortSignal`. Both locations are checked, and the
 * types below describe only the part this file calls.
 *
 * Tools unregister when the component that registered them is destroyed, so
 * the tool list always matches the page on screen.
 */

/** A JSON Schema object, as `inputSchema` expects. Kept loose on purpose. */
export type JsonSchema = Record<string, unknown>;

export interface WebMcpTool<Input = Record<string, unknown>> {
  /** Unique per page. snake_case, prefixed by the area it acts on. */
  name: string;
  /** What the agent reads to decide when to call it. Say what it returns. */
  description: string;
  inputSchema: JsonSchema;
  execute(input: Input): unknown;
}

/** What a tool call answers when its handler throws. */
export interface WebMcpToolFailure {
  ok: false;
  error: string;
}

interface ModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void> | void;
}

/**
 * Whether tools register at all. Dev mode by default; a spec overrides it to
 * test both sides without flipping Angular's global dev-mode flag.
 */
export const WEB_MCP_ENABLED = new InjectionToken<boolean>('WEB_MCP_ENABLED', {
  providedIn: 'root',
  factory: () => isDevMode(),
});

/** The API's current home, or its old one, or `null` when absent. */
export function findModelContext(document: Document): ModelContext | null {
  const candidates = [
    (document as { modelContext?: unknown }).modelContext,
    (document.defaultView?.navigator as { modelContext?: unknown } | undefined)
      ?.modelContext,
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as ModelContext).registerTool === 'function'
    ) {
      return candidate as ModelContext;
    }
  }

  return null;
}

/**
 * Register `tools` for as long as the calling component lives.
 *
 * Call it from a constructor or field initializer: it needs an injection
 * context for `DestroyRef`.
 */
export function registerWebMcpTools(
  // Each tool narrows its own input type; the list only needs the shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: WebMcpTool<any>[],
): void {
  const enabled = inject(WEB_MCP_ENABLED);
  const platformId = inject(PLATFORM_ID);
  const document = inject(DOCUMENT);
  const destroyRef = inject(DestroyRef);

  if (!enabled || !isPlatformBrowser(platformId)) {
    return;
  }

  const modelContext = findModelContext(document);
  if (modelContext === null) {
    return;
  }

  const controller = new AbortController();
  destroyRef.onDestroy(() => controller.abort());

  for (const tool of tools) {
    // A duplicate name rejects (an HMR reload can race the old component's
    // teardown). Log it rather than break the page: tools are a dev aid.
    Promise.resolve()
      .then(() =>
        modelContext.registerTool(
          { ...tool, execute: reportFailures(tool) },
          { signal: controller.signal },
        ),
      )
      .catch((error: unknown) =>
        console.warn(`[webmcp] could not register ${tool.name}:`, error),
      );
  }
}

/**
 * A thrown handler reaches the agent as a bare "UnknownError". Catch it and
 * answer with the message instead, so the agent learns what went wrong.
 */
function reportFailures(tool: WebMcpTool): WebMcpTool['execute'] {
  return async (input) => {
    try {
      return await tool.execute(input ?? {});
    } catch (error) {
      const failure: WebMcpToolFailure = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return failure;
    }
  };
}
