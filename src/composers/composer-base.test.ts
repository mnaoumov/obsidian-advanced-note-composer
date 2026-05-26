import type {
  App,
  CachedMetadata,
  Editor,
  TFile
} from 'obsidian';

import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { InsertMode } from '../insert-mode.ts';
import {
  getInsertModeFromEvent,
  getSelectionUnderHeading
} from './composer-base.ts';

vi.mock('obsidian-dev-utils/obsidian/link', () => ({
  editLinks: vi.fn(),
  updateLink: vi.fn(),
  updateLinksInContent: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn(),
  getCacheSafe: vi.fn(),
  getFrontmatterSafe: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  process: vi.fn()
}));

vi.mock('obsidian-dev-utils/string', () => ({
  replaceAll: vi.fn((str: string, regex: RegExp, replacer: (match: { groups: Record<string, string | undefined> | undefined }) => string) => {
    return str.replace(regex, (...args: unknown[]) => {
      const groups = args[args.length - 1] as Record<string, string | undefined> | undefined;
      return replacer({ groups });
    });
  })
}));

vi.mock('obsidian-dev-utils/function', () => ({
  noop: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/object-utils', () => ({
  extractDefaultExportInterop: (m: unknown) => m
}));

vi.mock('../markdown-heading-document.ts', () => ({
  parseMarkdownHeadingDocument: vi.fn()
}));

describe('getInsertModeFromEvent', () => {
  it('should return Prepend when shift key is held', () => {
    const event = { shiftKey: true } as KeyboardEvent;
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Prepend);
  });

  it('should return Append when shift key is not held', () => {
    const event = { shiftKey: false } as KeyboardEvent;
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Append);
  });

  it('should return Append for mouse event without shift', () => {
    const event = { shiftKey: false } as MouseEvent;
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Append);
  });

  it('should return Prepend for mouse event with shift', () => {
    const event = { shiftKey: true } as MouseEvent;
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Prepend);
  });
});

describe('getSelectionUnderHeading', () => {
  function createMockEditor(lines: string[]): Editor {
    return {
      getLine: vi.fn((n: number) => lines[n] ?? ''),
      lineCount: vi.fn(() => lines.length)
    } as unknown as Editor;
  }

  function createMockApp(cache: CachedMetadata | null): App {
    return {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(cache)
      }
    } as unknown as App;
  }

  it('should return null when no cache exists', () => {
    const app = createMockApp(null);
    const file = {} as TFile;
    const editor = createMockEditor(['# Heading', 'text']);

    expect(getSelectionUnderHeading(app, file, editor, 0)).toBeNull();
  });

  it('should return null when no heading at line number', () => {
    const app = createMockApp({
      headings: [
        {
          heading: 'Heading',
          level: 1,
          position: { end: { col: 9, line: 0, offset: 9 }, start: { col: 0, line: 0, offset: 0 } }
        }
      ]
    });
    const file = {} as TFile;
    const editor = createMockEditor(['# Heading', 'text', 'more text']);

    expect(getSelectionUnderHeading(app, file, editor, 1)).toBeNull();
  });

  it('should return heading info when heading found at line', () => {
    const app = createMockApp({
      headings: [
        {
          heading: 'Heading',
          level: 1,
          position: { end: { col: 9, line: 0, offset: 9 }, start: { col: 0, line: 0, offset: 0 } }
        }
      ]
    });
    const file = {} as TFile;
    const lines = ['# Heading', 'text under heading', 'more text'];
    const editor = createMockEditor(lines);

    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.heading).toBe('Heading');
    expect(result?.start.line).toBe(0);
    expect(result?.end.line).toBe(2);
  });

  it('should stop at next heading of same or higher level', () => {
    const app = createMockApp({
      headings: [
        {
          heading: 'First',
          level: 2,
          position: { end: { col: 8, line: 0, offset: 8 }, start: { col: 0, line: 0, offset: 0 } }
        },
        {
          heading: 'Second',
          level: 2,
          position: { end: { col: 9, line: 3, offset: 30 }, start: { col: 0, line: 3, offset: 21 } }
        }
      ]
    });
    const file = {} as TFile;
    const lines = ['## First', 'content 1', '', '## Second', 'content 2'];
    const editor = createMockEditor(lines);

    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.heading).toBe('First');
    expect(result?.end.line).toBe(1);
  });

  it('should skip trailing empty lines before next heading', () => {
    const app = createMockApp({
      headings: [
        {
          heading: 'First',
          level: 1,
          position: { end: { col: 7, line: 0, offset: 7 }, start: { col: 0, line: 0, offset: 0 } }
        },
        {
          heading: 'Second',
          level: 1,
          position: { end: { col: 8, line: 4, offset: 30 }, start: { col: 0, line: 4, offset: 22 } }
        }
      ]
    });
    const file = {} as TFile;
    const lines = ['# First', 'content', '', '', '# Second'];
    const editor = createMockEditor(lines);

    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.end.line).toBe(1);
  });

  it('should include sub-headings in selection', () => {
    const app = createMockApp({
      headings: [
        {
          heading: 'Parent',
          level: 1,
          position: { end: { col: 8, line: 0, offset: 8 }, start: { col: 0, line: 0, offset: 0 } }
        },
        {
          heading: 'Child',
          level: 2,
          position: { end: { col: 8, line: 2, offset: 20 }, start: { col: 0, line: 2, offset: 12 } }
        }
      ]
    });
    const file = {} as TFile;
    const lines = ['# Parent', 'text', '## Child', 'child text'];
    const editor = createMockEditor(lines);

    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.end.line).toBe(3);
  });

  it('should handle cache without headings', () => {
    const app = createMockApp({});
    const file = {} as TFile;
    const editor = createMockEditor(['text']);

    expect(getSelectionUnderHeading(app, file, editor, 0)).toBeNull();
  });
});
