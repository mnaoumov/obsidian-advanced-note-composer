import type { App } from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { RenderLinkHandlersWarmupComponent } from './render-link-handlers-warmup-component.ts';

interface MockAppResult {
  readonly app: App;
  readonly onLayoutReady: ReturnType<typeof vi.fn>;
}

function createMockApp(): MockAppResult {
  const onLayoutReady = vi.fn();
  const app = strictProxy<App>({
    workspace: {
      onLayoutReady
    }
  });
  return { app, onLayoutReady };
}

describe('RenderLinkHandlersWarmupComponent', () => {
  it('registers a layout-ready handler on load', () => {
    const { app, onLayoutReady } = createMockApp();
    const component = new RenderLinkHandlersWarmupComponent({ app });

    component.load();

    expect(onLayoutReady).toHaveBeenCalledOnce();
  });
});
