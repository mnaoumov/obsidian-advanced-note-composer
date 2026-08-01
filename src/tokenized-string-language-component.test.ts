import type {
  Grammar,
  Languages,
  PrismModule
} from '@obsidian-typings/obsidian-public-latest';

import { loadPrism } from '@obsidian-typings/obsidian-public-latest/implementations';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  TOKENIZED_STRING_LANGUAGE,
  TokenizedStringLanguageComponent
} from './tokenized-string-language-component.ts';

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

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', () => ({
  loadPrism: vi.fn()
}));

const mockLoadPrism = vi.mocked(loadPrism);

/**
 * Creates the language map the mocked Prism module exposes.
 *
 * Deliberately a plain object rather than a `strictProxy`: `SyntaxHighlightingComponent` READS
 * `prism.languages[language]` before writing it (it restores the previous grammar on unload), and a strict
 * proxy throws on an absent key — so proxying it would fail the registration it is meant to observe. This
 * mirrors how `obsidian-dev-utils` mocks Prism in its own suite.
 *
 * @returns An empty language map.
 */
function createMockLanguages(): Languages {
  return castTo<Languages>({});
}

describe('TokenizedStringLanguageComponent', () => {
  it('should export TOKENIZED_STRING_LANGUAGE constant', () => {
    expect(TOKENIZED_STRING_LANGUAGE).toBe('advanced-note-composer-template');
  });

  it('should register language on load', async () => {
    const languages = createMockLanguages();
    mockLoadPrism.mockResolvedValue(castTo<PrismModule>({ languages }));

    const component = new TokenizedStringLanguageComponent();
    component.load();

    await vi.waitFor(() => {
      expect(languages[TOKENIZED_STRING_LANGUAGE]).toBeDefined();
    });
  });

  it('should define expression pattern in language', async () => {
    const languages = createMockLanguages();
    mockLoadPrism.mockResolvedValue(castTo<PrismModule>({ languages }));

    const component = new TokenizedStringLanguageComponent();
    component.load();

    await vi.waitFor(() => {
      const lang = languages[TOKENIZED_STRING_LANGUAGE] as PrismLanguage;
      expect(lang.expression.pattern).toBeInstanceOf(RegExp);
      expect(lang.expression.pattern.test('{{content}}')).toBe(true);
    });
  });

  it('should define inside tokens for expression', async () => {
    const languages = createMockLanguages();
    mockLoadPrism.mockResolvedValue(castTo<PrismModule>({ languages }));

    const component = new TokenizedStringLanguageComponent();
    component.load();

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
    const languages = createMockLanguages();
    mockLoadPrism.mockResolvedValue(castTo<PrismModule>({ languages }));

    const component = new TokenizedStringLanguageComponent();
    component.load();

    await vi.waitFor(() => {
      expect(languages[TOKENIZED_STRING_LANGUAGE]).toBeDefined();
    });

    component.unload();
    expect(TOKENIZED_STRING_LANGUAGE in languages).toBe(false);
  });
});
