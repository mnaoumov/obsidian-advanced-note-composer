import type {
  Grammar,
  Languages,
  PrismModule
} from '@obsidian-typings/obsidian-public-latest';

import { loadPrism } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  bypassStrictProxy,
  strictProxy
} from 'obsidian-dev-utils/strict-proxy';
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

interface PrismExpression {
  pattern: RegExp;
}

interface PrismExpressionWithInside extends PrismExpression {
  inside: Record<string, PrismExpression>;
}

type PrismLanguage = Grammar & PrismLanguageRaw;

interface PrismLanguageRaw {
  expression: PrismExpressionWithInside;
}

interface WithTriggerUnload {
  triggerUnload(): void;
}

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
    const languages = strictProxy<Languages>({});
    mockLoadPrism.mockResolvedValue(strictProxy<PrismModule>({ languages }));

    const component = new PrismComponent();
    component.onload();

    await vi.waitFor(() => {
      expect(languages[TOKENIZED_STRING_LANGUAGE]).toBeDefined();
    });
  });

  it('should define expression pattern in language', async () => {
    const languages = strictProxy<Languages>({});
    mockLoadPrism.mockResolvedValue(strictProxy<PrismModule>({ languages }));

    const component = new PrismComponent();
    component.onload();

    await vi.waitFor(() => {
      const lang = languages[TOKENIZED_STRING_LANGUAGE] as PrismLanguage;
      expect(lang.expression.pattern).toBeInstanceOf(RegExp);
      expect(lang.expression.pattern.test('{{content}}')).toBe(true);
    });
  });

  it('should define inside tokens for expression', async () => {
    const languages = strictProxy<Languages>({});
    mockLoadPrism.mockResolvedValue(strictProxy<PrismModule>({ languages }));

    const component = new PrismComponent();
    component.onload();

    await vi.waitFor(() => {
      const lang = languages[TOKENIZED_STRING_LANGUAGE] as PrismLanguage;
      const inside = lang.expression.inside;
      expect(inside['prefix']).toBeDefined();
      expect(inside['token']).toBeDefined();
      expect(inside['formatDelimiter']).toBeDefined();
      expect(inside['format']).toBeDefined();
      expect(inside['suffix']).toBeDefined();
    });
  });

  it('should unregister language on unload', async () => {
    const languages = strictProxy<Languages>({});
    mockLoadPrism.mockResolvedValue(strictProxy<PrismModule>({ languages }));

    const component = new PrismComponent();
    component.onload();

    await vi.waitFor(() => {
      expect(languages[TOKENIZED_STRING_LANGUAGE]).toBeDefined();
    });

    (component as PrismComponent & WithTriggerUnload).triggerUnload();
    expect(bypassStrictProxy(languages)[TOKENIZED_STRING_LANGUAGE]).toBeUndefined();
  });
});
