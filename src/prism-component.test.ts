import { loadPrism } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  PrismComponent,
  TOKENIZED_STRING_LANGUAGE
} from './prism-component.ts';

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', () => ({
  loadPrism: vi.fn()
}));

vi.mock('obsidian-dev-utils/async', () => ({
  invokeAsyncSafely: vi.fn((fn: () => Promise<void>) => {
    fn().catch(() => {
      // Noop
    });
  })
}));

vi.mock('obsidian-dev-utils/obsidian/components/component-ex', () => {
  class ComponentEx {
    private readonly unloadCallbacks: (() => void)[] = [];

    public onload(): void {
      // Base onload
    }

    public triggerUnload(): void {
      for (const cb of this.unloadCallbacks) {
        cb();
      }
    }

    protected register(cb: () => void): void {
      this.unloadCallbacks.push(cb);
    }
  }
  return { ComponentEx };
});

const mockLoadPrism = vi.mocked(loadPrism);

describe('PrismComponent', () => {
  it('should export TOKENIZED_STRING_LANGUAGE constant', () => {
    expect(TOKENIZED_STRING_LANGUAGE).toBe('advanced-note-composer-template');
  });

  it('should register language on load', async () => {
    const languages: Record<string, unknown> = {};
    mockLoadPrism.mockResolvedValue({ languages } as never);

    const component = new PrismComponent();
    component.onload();

    await vi.waitFor(() => {
      expect(languages[TOKENIZED_STRING_LANGUAGE]).toBeDefined();
    });
  });

  it('should define expression pattern in language', async () => {
    const languages: Record<string, unknown> = {};
    mockLoadPrism.mockResolvedValue({ languages } as never);

    const component = new PrismComponent();
    component.onload();

    await vi.waitFor(() => {
      const lang = languages[TOKENIZED_STRING_LANGUAGE] as { expression: { pattern: RegExp } };
      expect(lang.expression.pattern).toBeInstanceOf(RegExp);
      expect(lang.expression.pattern.test('{{content}}')).toBe(true);
    });
  });

  it('should unregister language on unload', async () => {
    const languages: Record<string, unknown> = {};
    mockLoadPrism.mockResolvedValue({ languages } as never);

    const component = new PrismComponent();
    component.onload();

    await vi.waitFor(() => {
      expect(languages[TOKENIZED_STRING_LANGUAGE]).toBeDefined();
    });

    (component as unknown as { triggerUnload(): void }).triggerUnload();
    expect(languages[TOKENIZED_STRING_LANGUAGE]).toBeUndefined();
  });
});
