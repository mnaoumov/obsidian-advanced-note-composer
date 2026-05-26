import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { MergeComposer } from './merge-composer.ts';

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
  createFragmentAsync: vi.fn().mockResolvedValue(activeDocument.createDocumentFragment())
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(activeDocument.createElement('span'))
}));

vi.mock('obsidian-dev-utils/obsidian/link', () => ({
  editLinks: vi.fn(),
  extractLinkFile: vi.fn(),
  updateLink: vi.fn(),
  updateLinksInContent: vi.fn().mockImplementation(({ content }: { content: string }) => content)
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  process: vi.fn(),
  trashSafe: vi.fn()
}));

vi.mock('obsidian-dev-utils/string', () => ({
  replaceAll: vi.fn((str: string) => str)
}));

vi.mock('obsidian-dev-utils/function', () => ({
  noop: vi.fn()
}));

vi.mock('obsidian-dev-utils/object-utils', () => ({
  extractDefaultExportInterop: (m: unknown) => m
}));

vi.mock('../markdown-heading-document.ts', () => ({
  parseMarkdownHeadingDocument: vi.fn()
}));

describe('MergeComposer', () => {
  it('should be constructable', () => {
    const plugin = {
      app: {
        fileManager: {},
        metadataCache: { getFileCache: vi.fn() },
        plugins: { plugins: {} },
        vault: { cachedRead: vi.fn(), read: vi.fn() },
        workspace: {}
      },
      consoleDebug: vi.fn(),
      pluginSettingsComponent: {
        settings: {
          defaultFrontmatterMergeStrategy: 'MergeAndPreferNewValues',
          mergeTemplate: '\n\n{{content}}',
          shouldFixFootnotesByDefault: true,
          shouldMergeHeadingsByDefault: false,
          shouldOpenNoteAfterMerge: false,
          shouldRunTemplaterOnDestinationFile: false
        }
      }
    };

    const composer = new MergeComposer({
      isNewTargetFile: false,
      plugin: plugin as never,
      sourceFile: { basename: 'source', path: 'source.md' } as never,
      targetFile: { basename: 'target', path: 'target.md' } as never
    });

    expect(composer).toBeDefined();
  });
});
