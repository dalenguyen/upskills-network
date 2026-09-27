import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import type { WebMcpTool } from './web-mcp';

/** A stand-in for `document.modelContext` that records what registers. */
export class FakeModelContext {
  readonly tools = new Map<string, WebMcpTool>();

  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }) {
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener('abort', () =>
      this.tools.delete(tool.name),
    );
    return Promise.resolve();
  }

  /** Call a tool the way an agent would, by name. */
  async call(name: string, input: Record<string, unknown> = {}) {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      throw new Error(`${name} is not registered`);
    }
    return tool.execute(input);
  }
}

/** Put `fake` where the browser exposes the API; returns the cleanup. */
export function installModelContext(fake: FakeModelContext): () => void {
  const document = TestBed.inject(DOCUMENT) as { modelContext?: unknown };
  document.modelContext = fake;
  return () => delete document.modelContext;
}
