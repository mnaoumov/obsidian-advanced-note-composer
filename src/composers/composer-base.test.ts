import type { CustomArrayDict } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  CachedMetadata,
  Editor,
  MetadataCache,
  Reference,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  editLinks,
  updateLink,
  updateLinksInContent
} from 'obsidian-dev-utils/obsidian/link';
import {
  getBacklinksForFileSafe,
  getCacheSafe,
  getFrontmatterSafe
} from 'obsidian-dev-utils/obsidian/metadata-cache';
import { process as processVault } from 'obsidian-dev-utils/obsidian/vault';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { resolveValue } from 'obsidian-dev-utils/value-provider';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { MarkdownHeadingDocument } from '../markdown-heading-document.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type {
  ComposerBaseConstructorParams,
  Selection
} from './composer-base.ts';

import { InsertMode } from '../insert-mode.ts';
import { parseMarkdownHeadingDocument } from '../markdown-heading-document.ts';
import {
  Action,
  FrontmatterMergeStrategy
} from '../plugin-settings.ts';
import {
  ComposerBase,
  getInsertModeFromEvent,
  getSelectionUnderHeading
} from './composer-base.ts';

interface ComposerDeps {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

vi.mock('obsidian-dev-utils/obsidian/link', () => ({
  editLinks: vi.fn(),
  updateLink: vi.fn(),
  updateLinksInContent: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(activeDocument.createElement('span'))
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  process: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
  createFragmentAsync: vi.fn().mockResolvedValue(activeDocument.createDocumentFragment())
}));

vi.mock('../markdown-heading-document.ts', () => ({
  parseMarkdownHeadingDocument: vi.fn()
}));

class TestComposer extends ComposerBase {
  public backlinkSubpaths = new Set<string>();
  public selectionsToReturn: Selection[] = [];
  public templateToReturn = '{{content}}';

  public get appForTest(): App {
    return this.app;
  }

  public constructor(params: ComposerBaseConstructorParams, shouldIncludeFrontmatter = false) {
    super(params, shouldIncludeFrontmatter);
  }

  public async callCanIncludeFrontmatter(): Promise<boolean> {
    return this.canIncludeFrontmatter();
  }

  public async callCheckTargetFileIgnored(): Promise<boolean> {
    return this.checkTargetFileIgnored(Action.Merge);
  }

  public async callFixBacklinks(backlinksToFix: Map<string, string[]>, updatedFilePaths: Set<string>, updatedLinks: Set<string>): Promise<void> {
    return this.fixBacklinks(backlinksToFix, updatedFilePaths, updatedLinks);
  }

  public async callInsertIntoTargetFile(content: string): Promise<void> {
    return this.insertIntoTargetFile(content);
  }

  public callIsPathIgnored(path: string): boolean {
    return this.isPathIgnored(path);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Base class requires async.
  protected override async getSelections(): Promise<Selection[]> {
    return this.selectionsToReturn;
  }

  protected override getTemplate(): string {
    return this.templateToReturn;
  }

  protected override prepareBacklinkSubpaths(): Set<string> {
    return this.backlinkSubpaths;
  }
}

function createComposer(settingsOverrides?: Partial<PluginSettings>, shouldIncludeFrontmatter = false): TestComposer {
  const deps = createDeps(settingsOverrides);
  return new TestComposer({
    ...deps,
    isNewTargetFile: false,
    sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
    targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
  }, shouldIncludeFrontmatter);
}

function createDeps(overrides?: Partial<PluginSettings>): ComposerDeps {
  return castTo<ComposerDeps>({
    app: {
      fileManager: {
        generateMarkdownLink: vi.fn(),
        insertIntoFile: vi.fn(),
        processFrontMatter: vi.fn()
      },
      metadataCache: { getFileCache: vi.fn().mockReturnValue({}) },
      plugins: { plugins: {} },
      vault: {
        cachedRead: vi.fn().mockResolvedValue(''),
        read: vi.fn().mockResolvedValue('')
      },
      workspace: {
        getActiveFile: vi.fn(),
        getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() })
      }
    },
    consoleDebugComponent: {
      consoleDebug: vi.fn()
    },
    pluginSettingsComponent: {
      settings: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
        isPathIgnored: vi.fn().mockReturnValue(false),
        mergeTemplate: '{{content}}',
        shouldFixFootnotesByDefault: false,
        shouldMergeHeadingsByDefault: false,
        shouldOpenNoteAfterMerge: false,
        shouldRunTemplaterOnDestinationFile: false,
        ...overrides
      }
    }
  });
}

function getAppObj(app: App): GenericObject {
  return castTo<GenericObject>(app);
}

function getComposerAppObj(composer: TestComposer): GenericObject {
  return castTo<GenericObject>(composer.appForTest);
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    return strictProxy<Editor>({
      getLine: vi.fn((n: number) => lines[n] ?? ''),
      lineCount: vi.fn(() => lines.length)
    });
  }

  function createMockApp(cache: CachedMetadata | null): App {
    return strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn().mockReturnValue(cache)
      })
    });
  }

  it('should return null when no cache exists', () => {
    const app = createMockApp(null);
    const file = strictProxy<TFile>({});
    const editor = createMockEditor(['# Heading', 'text']);
    expect(getSelectionUnderHeading(app, file, editor, 0)).toBeNull();
  });

  it('should return null when no heading at line number', () => {
    const app = createMockApp({
      headings: [{
        heading: 'Heading',
        level: 1,
        position: { end: { col: 9, line: 0, offset: 9 }, start: { col: 0, line: 0, offset: 0 } }
      }]
    });
    const file = strictProxy<TFile>({});
    const editor = createMockEditor(['# Heading', 'text', 'more text']);
    expect(getSelectionUnderHeading(app, file, editor, 1)).toBeNull();
  });

  it('should return heading info when heading found at line', () => {
    const app = createMockApp({
      headings: [{
        heading: 'Heading',
        level: 1,
        position: { end: { col: 9, line: 0, offset: 9 }, start: { col: 0, line: 0, offset: 0 } }
      }]
    });
    const file = strictProxy<TFile>({});
    const editor = createMockEditor(['# Heading', 'text under heading', 'more text']);
    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.heading).toBe('Heading');
    expect(result?.start.line).toBe(0);
    expect(result?.end.line).toBe(2);
  });

  it('should stop at next heading of same or higher level', () => {
    const app = createMockApp({
      headings: [
        { heading: 'First', level: 2, position: { end: { col: 8, line: 0, offset: 8 }, start: { col: 0, line: 0, offset: 0 } } },
        { heading: 'Second', level: 2, position: { end: { col: 9, line: 3, offset: 30 }, start: { col: 0, line: 3, offset: 21 } } }
      ]
    });
    const file = strictProxy<TFile>({});
    const editor = createMockEditor(['## First', 'content 1', '', '## Second', 'content 2']);
    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.heading).toBe('First');
    expect(result?.end.line).toBe(1);
  });

  it('should skip trailing empty lines before next heading', () => {
    const app = createMockApp({
      headings: [
        { heading: 'First', level: 1, position: { end: { col: 7, line: 0, offset: 7 }, start: { col: 0, line: 0, offset: 0 } } },
        { heading: 'Second', level: 1, position: { end: { col: 8, line: 4, offset: 30 }, start: { col: 0, line: 4, offset: 22 } } }
      ]
    });
    const file = strictProxy<TFile>({});
    const editor = createMockEditor(['# First', 'content', '', '', '# Second']);
    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.end.line).toBe(1);
  });

  it('should include sub-headings in selection', () => {
    const app = createMockApp({
      headings: [
        { heading: 'Parent', level: 1, position: { end: { col: 8, line: 0, offset: 8 }, start: { col: 0, line: 0, offset: 0 } } },
        { heading: 'Child', level: 2, position: { end: { col: 8, line: 2, offset: 20 }, start: { col: 0, line: 2, offset: 12 } } }
      ]
    });
    const file = strictProxy<TFile>({});
    const editor = createMockEditor(['# Parent', 'text', '## Child', 'child text']);
    const result = getSelectionUnderHeading(app, file, editor, 0);
    expect(result).not.toBeNull();
    expect(result?.end.line).toBe(3);
  });

  it('should handle cache without headings', () => {
    const app = createMockApp({});
    const file = strictProxy<TFile>({});
    const editor = createMockEditor(['text']);
    expect(getSelectionUnderHeading(app, file, editor, 0)).toBeNull();
  });
});

describe('ComposerBase constructor', () => {
  it('should assign all fields from options', () => {
    const composer = createComposer();
    expect(composer).toBeDefined();
  });

  it('should use defaults from settings when options are not provided', () => {
    const deps = createDeps();
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    expect(composer).toBeDefined();
  });

  it('should use explicit option values when provided', () => {
    const deps = createDeps();
    const composer = new TestComposer({
      frontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter,
      insertMode: InsertMode.Prepend,
      isNewTargetFile: true,
      ...deps,
      shouldFixFootnotes: true,
      shouldMergeHeadings: true,
      shouldShowNotice: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    expect(composer).toBeDefined();
  });
});

describe('canIncludeFrontmatter', () => {
  it('should return false when no cache exists', async () => {
    const composer = createComposer();
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    expect(await composer.callCanIncludeFrontmatter()).toBe(false);
  });

  it('should return false when no frontmatter position in cache', async () => {
    const composer = createComposer();
    vi.mocked(getCacheSafe).mockResolvedValue({});
    expect(await composer.callCanIncludeFrontmatter()).toBe(false);
  });

  it('should return false when no selections', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [];
    vi.mocked(getCacheSafe).mockResolvedValue({
      frontmatterPosition: { end: { col: 0, line: 3, offset: 30 }, start: { col: 0, line: 0, offset: 0 } }
    });
    expect(await composer.callCanIncludeFrontmatter()).toBe(false);
  });

  it('should return false when selection starts before frontmatter end', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 50, startOffset: 10 }];
    vi.mocked(getCacheSafe).mockResolvedValue({
      frontmatterPosition: { end: { col: 0, line: 3, offset: 30 }, start: { col: 0, line: 0, offset: 0 } }
    });
    expect(await composer.callCanIncludeFrontmatter()).toBe(false);
  });

  it('should return true when selection starts after frontmatter end', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 50 }];
    vi.mocked(getCacheSafe).mockResolvedValue({
      frontmatterPosition: { end: { col: 0, line: 3, offset: 30 }, start: { col: 0, line: 0, offset: 0 } }
    });
    expect(await composer.callCanIncludeFrontmatter()).toBe(true);
  });
});

describe('isPathIgnored', () => {
  it('should delegate to settings isPathIgnored', () => {
    const isPathIgnoredMock = vi.fn().mockReturnValue(true);
    const composer = createComposer({ isPathIgnored: isPathIgnoredMock });
    expect(composer.callIsPathIgnored('some/path.md')).toBe(true);
    expect(isPathIgnoredMock).toHaveBeenCalledWith('some/path.md');
  });
});

describe('checkTargetFileIgnored', () => {
  it('should return false when path is ignored', async () => {
    const composer = createComposer({ isPathIgnored: vi.fn().mockReturnValue(true) });
    expect(await composer.callCheckTargetFileIgnored()).toBe(false);
  });

  it('should return true when path is not ignored', async () => {
    const composer = createComposer({ isPathIgnored: vi.fn().mockReturnValue(false) });
    expect(await composer.callCheckTargetFileIgnored()).toBe(true);
  });
});

describe('insertIntoTargetFile', () => {
  it('should call insertIntoFile when shouldMergeHeadings is false', async () => {
    const insertIntoFileMock = vi.fn();
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: insertIntoFileMock, processFrontMatter: vi.fn() };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test content');
    expect(insertIntoFileMock).toHaveBeenCalled();
  });

  it('should use process when shouldMergeHeadings is true', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      shouldMergeHeadings: true,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test content');
    expect(processVault).toHaveBeenCalled();
  });

  it('should invoke wrapText via process callback when shouldMergeHeadings is true', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };

    const mockMergedDoc = { toString: vi.fn().mockReturnValue('merged content') };
    const mockTargetDoc = { mergeWith: vi.fn().mockReturnValue(mockMergedDoc) };
    const mockContentDoc = { wrapText: vi.fn().mockResolvedValue(undefined) };

    vi.mocked(parseMarkdownHeadingDocument)
      .mockResolvedValueOnce(castTo<MarkdownHeadingDocument>(mockTargetDoc))
      .mockResolvedValueOnce(castTo<MarkdownHeadingDocument>(mockContentDoc));

    // Make processVault actually call the callback
    vi.mocked(processVault).mockImplementation(async (_app, _file, callback) => {
      await resolveValue(callback, { content: 'existing content' });
    });

    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      shouldMergeHeadings: true,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.callInsertIntoTargetFile('test content');

    expect(mockContentDoc.wrapText).toHaveBeenCalled();
    expect(mockTargetDoc.mergeWith).toHaveBeenCalled();

    // Now test the wrapText callback that was passed to mockContentDoc.wrapText
    const wrapTextFn = mockContentDoc.wrapText.mock.calls[0]?.[0] as (text: string) => string;
    expect(wrapTextFn).toBeDefined();

    // Test non-empty text
    const result = wrapTextFn('some text');
    expect(result).toContain('some text');
    expect(result.startsWith('\n')).toBe(true);
    expect(result.endsWith('\n')).toBe(true);

    // Test empty text
    const emptyResult = wrapTextFn('');
    expect(emptyResult).toBe('');

    // Test whitespace-only text
    const whitespaceResult = wrapTextFn('   ');
    expect(whitespaceResult).toBe('');

    // Test text that already has newlines
    const newlineResult = wrapTextFn('\ntext\n');
    expect(newlineResult).toContain('text');
  });

  it('should update frontmatter merge strategy for new target files', async () => {
    const processFrontMatterMock = vi.fn();
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      frontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test content');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should skip frontmatter merge when strategy is KeepOriginalFrontmatter', async () => {
    const processFrontMatterMock = vi.fn();
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test content');
    expect(processFrontMatterMock).not.toHaveBeenCalled();
  });

  it('should run templater when enabled and plugin is available', async () => {
    const overwriteMock = vi.fn();
    const deps = createDeps({ shouldRunTemplaterOnDestinationFile: true });
    const appObj = getAppObj(deps.app);
    // eslint-disable-next-line camelcase -- Templater plugin API uses snake_case.
    appObj['plugins'] = { plugins: { 'templater-obsidian': { templater: { overwrite_file_commands: overwriteMock } } } };
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    appObj['workspace'] = { getActiveFile: vi.fn().mockReturnValue(null) };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test content');
    expect(overwriteMock).toHaveBeenCalled();
  });

  it('should complete when templater is enabled but not installed', async () => {
    const deps = createDeps({ shouldRunTemplaterOnDestinationFile: true });
    const appObj = getAppObj(deps.app);
    appObj['plugins'] = { plugins: {} };
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test content');
    expect(composer).toBeDefined();
  });

  it('should not show templater notice when shouldShowNotice is false', async () => {
    const deps = createDeps({ shouldRunTemplaterOnDestinationFile: true });
    const appObj = getAppObj(deps.app);
    appObj['plugins'] = { plugins: {} };
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      shouldShowNotice: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test content');
    expect(composer).toBeDefined();
  });

  it('should prepend newline when template content starts with frontmatter delimiter', async () => {
    const insertIntoFileMock = vi.fn();
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: insertIntoFileMock, processFrontMatter: vi.fn() };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '---\nfoo: bar\n---\n{{content}}';
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('body');
    const insertedContent = insertIntoFileMock.mock.calls[0]?.[1] as string;
    expect(insertedContent).toMatch(/^\n---/);
  });

  it('should show notice when backlinks are updated', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.backlinkSubpaths = new Set(['']);
    const backlinkMap = new Map<string, unknown[]>();
    backlinkMap.set('other.md', [{ link: 'source' }]);
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    vi.mocked(getBacklinksForFileSafe).mockResolvedValue(castTo<CustomArrayDict<Reference>>(backlinkMap));
    const linkJson = JSON.stringify({ link: 'source' });
    vi.mocked(editLinks).mockImplementation(async (_app, _path, callback) => {
      await callback(castTo<Reference>(JSON.parse(linkJson)));
    });
    vi.mocked(updateLink).mockReturnValue('updated-link');
    await composer.callInsertIntoTargetFile('test content');
    expect(editLinks).toHaveBeenCalled();
  });
});

describe('fixBacklinks', () => {
  it('should iterate backlinks and call editLinks/updateLink', async () => {
    const composer = createComposer();
    const linkObj = { link: 'source', original: '[[source]]' };
    const backlinksToFix = new Map<string, string[]>();
    backlinksToFix.set('other.md', [JSON.stringify(linkObj)]);
    const updatedFilePaths = new Set<string>();
    const updatedLinks = new Set<string>();
    vi.mocked(editLinks).mockImplementation(async (_app, _path, callback) => {
      await callback(linkObj);
    });
    vi.mocked(updateLink).mockReturnValue('updated');
    await composer.callFixBacklinks(backlinksToFix, updatedFilePaths, updatedLinks);
    expect(editLinks).toHaveBeenCalledWith(expect.anything(), 'other.md', expect.any(Function));
    expect(updatedFilePaths.has('other.md')).toBe(true);
    expect(updatedLinks.size).toBe(1);
  });

  it('should skip links not in the backlinksToFix map', async () => {
    const composer = createComposer();
    const linkObj = { link: 'source', original: '[[source]]' };
    const otherLinkObj = { link: 'other', original: '[[other]]' };
    const backlinksToFix = new Map<string, string[]>();
    backlinksToFix.set('other.md', [JSON.stringify(linkObj)]);
    const updatedFilePaths = new Set<string>();
    const updatedLinks = new Set<string>();
    vi.mocked(editLinks).mockImplementation(async (_app, _path, callback) => {
      await callback(otherLinkObj);
    });
    await composer.callFixBacklinks(backlinksToFix, updatedFilePaths, updatedLinks);
    expect(updatedFilePaths.size).toBe(0);
    expect(updatedLinks.size).toBe(0);
  });
});

describe('applyTemplate', () => {
  it('should replace {{fromPath}} with source file path', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{fromPath}}';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test');
    expect(insertIntoFileMock.mock.calls[0]?.[1]).toBe('source.md');
  });

  it('should replace {{fromTitle}} with source file basename', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{fromTitle}}';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test');
    expect(insertIntoFileMock.mock.calls[0]?.[1]).toBe('source');
  });

  it('should replace {{newPath}} with target file path', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{newPath}}';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test');
    expect(insertIntoFileMock.mock.calls[0]?.[1]).toBe('target.md');
  });

  it('should replace {{newTitle}} with target file basename', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{newTitle}}';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test');
    expect(insertIntoFileMock.mock.calls[0]?.[1]).toBe('target');
  });

  it('should replace {{content}} with the provided content', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = 'before {{content}} after';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('my text');
    expect(insertIntoFileMock.mock.calls[0]?.[1]).toBe('before my text after');
  });

  it('should replace {{date}} with formatted date', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{date}}';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test');
    expect(insertIntoFileMock.mock.calls[0]?.[1] as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should replace {{time}} with formatted time', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{time}}';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test');
    expect(insertIntoFileMock.mock.calls[0]?.[1] as string).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should throw on unknown template key', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{unknownKey}}';
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    let didThrow = false;
    try {
      await composer.callInsertIntoTargetFile('test');
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(true);
  });

  it('should support custom date format', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '{{date:DD/MM/YYYY}}';
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('test');
    expect(insertIntoFileMock.mock.calls[0]?.[1] as string).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('fixFootnotes', () => {
  it('should handle duplicate footnote references by skipping already-mapped ids', async () => {
    const insertIntoFileMock = vi.fn();
    const composer = createComposer({ shouldFixFootnotesByDefault: true });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    (appObj['vault'] as GenericObject)['cachedRead'] = vi.fn()
      .mockResolvedValueOnce('source [^fn1] and [^fn1] again')
      .mockResolvedValueOnce('target [^fn1]');
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        { id: 'fn1', position: { end: { col: 13, line: 0, offset: 13 }, start: { col: 7, line: 0, offset: 7 } } },
        { id: 'fn1', position: { end: { col: 27, line: 0, offset: 27 }, start: { col: 18, line: 0, offset: 18 } } }
      ],
      footnotes: []
    });
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('text [^fn1] and [^fn1] again');
    expect(insertIntoFileMock).toHaveBeenCalled();
  });

  it('should return content as-is when shouldFixFootnotes is false', async () => {
    const insertIntoFileMock = vi.fn();
    const composer = createComposer({ shouldFixFootnotesByDefault: false });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('text with [^1] footnote');
    expect(insertIntoFileMock.mock.calls[0]?.[1]).toBe('text with [^1] footnote');
  });

  it('should process footnotes when shouldFixFootnotes is true', async () => {
    const insertIntoFileMock = vi.fn();
    const composer = createComposer({ shouldFixFootnotesByDefault: true });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    (appObj['vault'] as GenericObject)['cachedRead'] = vi.fn().mockResolvedValueOnce('source [^note1]').mockResolvedValueOnce('target [^note1]');
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [{ id: 'note1', position: { end: { col: 15, line: 0, offset: 15 }, start: { col: 7, line: 0, offset: 7 } } }],
      footnotes: []
    });
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('text [^note1]');
    expect(insertIntoFileMock).toHaveBeenCalled();
  });
});

describe('fixLinks', () => {
  it('should call updateLinksInContent', async () => {
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(`fixed-${content}`));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    await composer.callInsertIntoTargetFile('test');
    expect(updateLinksInContent).toHaveBeenCalled();
  });
});

describe('includeFrontmatter', () => {
  it('should return content as-is when shouldIncludeFrontmatter is false', async () => {
    const composer = createComposer({}, false);
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 50 }];
    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue({
      frontmatterPosition: { end: { col: 0, line: 3, offset: 30 }, start: { col: 0, line: 0, offset: 0 } }
    });
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('body content');
    expect(insertIntoFileMock.mock.calls[0]?.[1]).toBe('body content');
  });

  it('should prepend frontmatter when enabled and canIncludeFrontmatter returns true', async () => {
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter });
    const appObj = getAppObj(deps.app);
    const insertIntoFileMock = vi.fn();
    appObj['fileManager'] = { insertIntoFile: insertIntoFileMock, processFrontMatter: vi.fn() };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    }, true);
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 50 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(castTo<CachedMetadata>({
      frontmatter: { key: 'value' },
      frontmatterPosition: { end: { col: 0, line: 3, offset: 30 }, start: { col: 0, line: 0, offset: 0 } }
    }));
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('body content');
    const insertedContent = insertIntoFileMock.mock.calls[0]?.[1] as string;
    expect(insertedContent).toContain('---');
  });
});

describe('mergeFrontmatter strategies', () => {
  it('should replace with new frontmatter when ReplaceWithNewFrontmatter', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ existingKey: 'old' });
    await composer.callInsertIntoTargetFile('---\nnewKey: new\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should preserve both frontmatters when PreserveBothOriginalAndNewFrontmatter', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('content');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should preserve original title when originalTitle is defined', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      const fm: GenericObject = { existingKey: 'val' };
      callback(fm);
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ title: 'Original Title' });
    await composer.callInsertIntoTargetFile('---\ntitle: New Title\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should merge arrays with unique values', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ tags: ['a', 'b'] });
    await composer.callInsertIntoTargetFile('---\ntags:\n  - b\n  - c\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should merge nested objects recursively', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ nested: { a: 1 } });
    await composer.callInsertIntoTargetFile('---\nnested:\n  b: 2\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should handle null values in original frontmatter during merge', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ key: null });
    await composer.callInsertIntoTargetFile('---\nkey: new-value\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should merge and prefer original values when MergeAndPreferOriginalValues', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferOriginalValues });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ key: 'original' });
    await composer.callInsertIntoTargetFile('---\nkey: new\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });
});

describe('prepareBacklinksToFix', () => {
  it('should handle headings in selections', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    appObj['metadataCache'] = {
      getFileCache: vi.fn().mockReturnValue({
        headings: [{ heading: 'Test Heading', level: 1, position: { end: { col: 14, line: 0, offset: 14 }, start: { col: 0, line: 0, offset: 0 } } }]
      })
    };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    vi.mocked(getBacklinksForFileSafe).mockResolvedValue(castTo<CustomArrayDict<Reference>>(new Map()));
    await composer.callInsertIntoTargetFile('test');
    expect(getBacklinksForFileSafe).toHaveBeenCalled();
  });

  it('should skip headings not in selections', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    appObj['metadataCache'] = {
      getFileCache: vi.fn().mockReturnValue({
        headings: [
          { heading: 'Selected', level: 1, position: { end: { col: 10, line: 0, offset: 10 }, start: { col: 0, line: 0, offset: 0 } } },
          { heading: 'Not Selected', level: 1, position: { end: { col: 14, line: 5, offset: 200 }, start: { col: 0, line: 5, offset: 186 } } }
        ]
      })
    };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    // Only select lines 0-50, the second heading at offset 186 is outside
    composer.selectionsToReturn = [{ endOffset: 50, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    vi.mocked(getBacklinksForFileSafe).mockResolvedValue(castTo<CustomArrayDict<Reference>>(new Map()));
    await composer.callInsertIntoTargetFile('test');
    expect(getBacklinksForFileSafe).toHaveBeenCalled();
  });

  it('should handle blocks in selections', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: vi.fn() };
    appObj['metadataCache'] = {
      getFileCache: vi.fn().mockReturnValue({
        blocks: { block1: { id: 'block1', position: { end: { col: 10, line: 2, offset: 20 }, start: { col: 0, line: 2, offset: 10 } } } }
      })
    };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    vi.mocked(getBacklinksForFileSafe).mockResolvedValue(castTo<CustomArrayDict<Reference>>(new Map()));
    await composer.callInsertIntoTargetFile('test');
    expect(getBacklinksForFileSafe).toHaveBeenCalled();
  });
});

describe('safeParseFrontmatter', () => {
  it('should handle invalid YAML frontmatter gracefully', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    // Invalid YAML that will cause parseYaml to throw
    await composer.callInsertIntoTargetFile('---\n: invalid: yaml: [[\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should handle content with valid frontmatter', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('---\nkey: value\n---\ncontent');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });

  it('should handle content without frontmatter', async () => {
    const processFrontMatterMock = vi.fn().mockImplementation((_file: TFile, callback: (fm: GenericObject) => void) => {
      callback({});
    });
    const deps = createDeps({ defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = { insertIntoFile: vi.fn(), processFrontMatter: processFrontMatterMock };
    const composer = new TestComposer({
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    await composer.callInsertIntoTargetFile('no frontmatter content');
    expect(processFrontMatterMock).toHaveBeenCalled();
  });
});
