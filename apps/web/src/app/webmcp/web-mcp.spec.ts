import { Component, PLATFORM_ID, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WEB_MCP_ENABLED,
  findModelContext,
  registerWebMcpTools,
} from './web-mcp';
import { FakeModelContext, installModelContext } from './web-mcp.testing';

@Component({ selector: 'app-host', template: '' })
class HostComponent {
  constructor() {
    registerWebMcpTools([
      {
        name: 'echo',
        description: 'Echo the input.',
        inputSchema: { type: 'object' },
        execute: (input: { text: string }) => ({ echoed: input.text }),
      },
      {
        name: 'boom',
        description: 'Always fails.',
        inputSchema: { type: 'object' },
        execute: () => {
          throw new Error('bad input');
        },
      },
    ]);
  }
}

/** Registration is async; let its promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('registerWebMcpTools', () => {
  let fake: FakeModelContext;
  let uninstall: () => void;

  function setup(providers: Provider[] = []) {
    TestBed.configureTestingModule({
      providers: [{ provide: WEB_MCP_ENABLED, useValue: true }, ...providers],
    });
    fake = new FakeModelContext();
    uninstall = installModelContext(fake);
    return TestBed.createComponent(HostComponent);
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => uninstall?.());

  it('registers tools while the component lives, and drops them on destroy', async () => {
    const fixture = setup();
    await settle();

    expect([...fake.tools.keys()]).toEqual(['echo', 'boom']);
    await expect(fake.call('echo', { text: 'hi' })).resolves.toEqual({
      echoed: 'hi',
    });

    fixture.destroy();
    expect(fake.tools.size).toBe(0);
  });

  it('answers a thrown handler with its message instead of throwing', async () => {
    setup();
    await settle();

    await expect(fake.call('boom')).resolves.toEqual({
      ok: false,
      error: 'bad input',
    });
  });

  it('registers nothing when disabled (production builds)', async () => {
    setup([{ provide: WEB_MCP_ENABLED, useValue: false }]);
    await settle();

    expect(fake.tools.size).toBe(0);
  });

  it('registers nothing during server rendering', async () => {
    setup([{ provide: PLATFORM_ID, useValue: 'server' }]);
    await settle();

    expect(fake.tools.size).toBe(0);
  });
});

describe('findModelContext', () => {
  const registerTool = () => undefined;

  it('prefers document.modelContext', () => {
    const modelContext = { registerTool };
    const document = { modelContext, defaultView: null } as unknown as Document;

    expect(findModelContext(document)).toBe(modelContext);
  });

  it('falls back to the older navigator.modelContext', () => {
    const modelContext = { registerTool };
    const document = {
      defaultView: { navigator: { modelContext } },
    } as unknown as Document;

    expect(findModelContext(document)).toBe(modelContext);
  });

  it('is null when the browser has no WebMCP', () => {
    const document = {
      defaultView: { navigator: {} },
    } as unknown as Document;

    expect(findModelContext(document)).toBeNull();
  });
});
