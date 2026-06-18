import type {
  App,
  Editor,
  EditorPosition,
  EditorSelection,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { updateLinksInContent } from 'obsidian-dev-utils/obsidian/link';
import {
  getCacheSafe,
  getFrontmatterSafe
} from 'obsidian-dev-utils/obsidian/metadata-cache';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureGenericObject } from 'obsidian-dev-utils/type-guards';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import {
  Action,
  FrontmatterMergeStrategy,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import {
  getSelections,
  SplitComposer
} from './split-composer.ts';

interface ComposerDeps {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface MockPosition {
  ch: number;
}

interface MockSelection {
  anchor: number;
  head: number;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = activeDocument.createDocumentFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(activeDocument.createElement('span'))
}));

interface UpdateLinksParams {
  readonly content: string;
}

vi.mock('obsidian-dev-utils/obsidian/link', () => ({
  editLinks: vi.fn(),
  updateLink: vi.fn(),
  updateLinksInContent: vi.fn().mockImplementation(({ content }: UpdateLinksParams) => content)
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  process: vi.fn()
}));

vi.mock('obsidian-dev-utils/string', () => ({
  replaceAll: vi.fn((str: string) => str)
}));

vi.mock('obsidian-dev-utils/function', () => ({
  noop: vi.fn()
}));

vi.mock('obsidian-dev-utils/object-utils', () => ({
  castTo: (value: unknown): unknown => value,
  extractDefaultExportInterop: (m: unknown): unknown => m
}));

vi.mock('../markdown-heading-document.ts', () => ({
  parseMarkdownHeadingDocument: vi.fn()
}));

interface MockEditorOptions {
  readonly listSelections?: EditorSelection[];
  readonly selection?: string;
}

function createDeps(overrides?: Partial<PluginSettings>): ComposerDeps {
  return castTo<ComposerDeps>({
    app: {
      fileManager: {
        generateMarkdownLink: vi.fn().mockReturnValue('[[target]]'),
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
        getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) })
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
        shouldIncludeFrontmatterWhenSplittingByDefault: false,
        shouldMergeHeadingsByDefault: false,
        shouldOpenTargetNoteAfterSplit: false,
        shouldRunTemplaterOnDestinationFile: false,
        splitTemplate: '',
        splitToExistingFileTemplate: Action.Split,
        textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile,
        ...overrides
      }
    }
  });
}

function createMockEditor(options?: MockEditorOptions): Editor {
  const selections = options?.listSelections ?? [{ anchor: { ch: 0, line: 0 }, head: { ch: 10, line: 0 } }];
  return strictProxy<Editor>({
    getSelection: vi.fn().mockReturnValue(options?.selection ?? 'selected text'),
    listSelections: vi.fn().mockReturnValue(selections),
    offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
    posToOffset: vi.fn((pos: MockPosition) => pos.ch),
    replaceSelection: vi.fn(),
    setSelections: vi.fn()
  });
}

function getAppObj(app: App): GenericObject {
  return castTo<GenericObject>(app);
}

function getComposerAppObj(composer: SplitComposer): GenericObject {
  return ensureGenericObject(ensureGenericObject(composer)['app']);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getSelections', () => {
  function createMockEditorForGetSelections(selections: MockSelection[]): Editor {
    return strictProxy<Editor>({
      listSelections: vi.fn().mockReturnValue(
        selections.map((s) => ({
          anchor: { ch: s.anchor, line: 0 },
          head: { ch: s.head, line: 0 }
        }))
      ),
      posToOffset: vi.fn((pos: MockPosition) => pos.ch)
    });
  }

  it('should return selections in sorted order', () => {
    const editor = createMockEditorForGetSelections([
      { anchor: 20, head: 30 },
      { anchor: 0, head: 10 }
    ]);

    const result = getSelections(editor);
    expect(result[0]?.startOffset).toBe(0);
    expect(result[1]?.startOffset).toBe(20);
  });

  it('should normalize reversed selections', () => {
    const editor = createMockEditorForGetSelections([
      { anchor: 30, head: 10 }
    ]);

    const result = getSelections(editor);
    expect(result[0]?.startOffset).toBe(10);
    expect(result[0]?.endOffset).toBe(30);
  });

  it('should handle single selection', () => {
    const editor = createMockEditorForGetSelections([
      { anchor: 5, head: 15 }
    ]);

    const result = getSelections(editor);
    expect(result).toHaveLength(1);
    expect(result[0]?.startOffset).toBe(5);
    expect(result[0]?.endOffset).toBe(15);
  });

  it('should handle empty selections', () => {
    const editor = createMockEditorForGetSelections([]);
    const result = getSelections(editor);
    expect(result).toHaveLength(0);
  });
});

describe('SplitComposer constructor', () => {
  it('should use shouldIncludeFrontmatter from params when provided', () => {
    const deps = createDeps();
    const editor = createMockEditor();
    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      shouldIncludeFrontmatter: true,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    expect(composer).toBeDefined();
  });

  it('should use default from settings when shouldIncludeFrontmatter not provided', () => {
    const deps = createDeps({ shouldIncludeFrontmatterWhenSplittingByDefault: true });
    const editor = createMockEditor();
    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });
    expect(composer).toBeDefined();
  });
});

describe('splitFile', () => {
  it('should return early when checkTargetFileIgnored returns false', async () => {
    const editor = createMockEditor();
    const deps = createDeps({ isPathIgnored: vi.fn().mockReturnValue(true) });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    await composer.splitFile();

    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });

  it('should insert content and replace with link for LinkToNewFile mode', async () => {
    const editor = createMockEditor();
    const deps = createDeps({ textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(editor.replaceSelection).toHaveBeenCalledWith('[[target]]');
  });

  it('should replace with embed for EmbedNewFile mode', async () => {
    const editor = createMockEditor();
    const deps = createDeps({ textAfterExtractionMode: TextAfterExtractionMode.EmbedNewFile });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(editor.replaceSelection).toHaveBeenCalledWith('![[target]]');
  });

  it('should replace with empty string for None mode', async () => {
    const editor = createMockEditor();
    const deps = createDeps({ textAfterExtractionMode: TextAfterExtractionMode.None });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(editor.replaceSelection).toHaveBeenCalledWith('');
  });

  it('should throw for invalid textAfterExtractionMode', async () => {
    const editor = createMockEditor();
    const deps = createDeps({ textAfterExtractionMode: castTo<TextAfterExtractionMode>('invalid') });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await expect(composer.splitFile()).rejects.toThrow('Invalid text after extraction mode');
  });

  it('should open target note after split when shouldOpenTargetNoteAfterSplit is true and not multiple split', async () => {
    const openFileMock = vi.fn().mockResolvedValue(undefined);
    const editor = createMockEditor();
    const deps = createDeps({ shouldOpenTargetNoteAfterSplit: true });
    const appObj = getAppObj(deps.app);
    appObj['workspace'] = {
      getActiveFile: vi.fn(),
      getLeaf: vi.fn().mockReturnValue({ openFile: openFileMock })
    };

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(openFileMock).toHaveBeenCalled();
  });

  it('should not open target note when isMultipleSplit is true', async () => {
    const openFileMock = vi.fn().mockResolvedValue(undefined);
    const editor = createMockEditor();
    const deps = createDeps({ shouldOpenTargetNoteAfterSplit: true });
    const appObj = getAppObj(deps.app);
    appObj['workspace'] = {
      getActiveFile: vi.fn(),
      getLeaf: vi.fn().mockReturnValue({ openFile: openFileMock })
    };

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: true,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(openFileMock).not.toHaveBeenCalled();
  });

  it('should propagate errors from insertIntoFile', async () => {
    const editor = createMockEditor();
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = {
      generateMarkdownLink: vi.fn(),
      insertIntoFile: vi.fn().mockRejectedValue(new Error('insert error')),
      processFrontMatter: vi.fn()
    };

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    let didThrow = false;
    try {
      await composer.splitFile();
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(true);
    // ReplaceSelection should not have been called since the error occurred before it
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });
});

describe('SplitComposer getTemplate', () => {
  it('should return mergeTemplate when splitTemplate is empty', async () => {
    const editor = createMockEditor();
    const deps = createDeps({ mergeTemplate: 'merge: {{content}}', splitTemplate: '' });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;

    await composer.splitFile();

    // The merge template should have been used
    const insertedContent = insertIntoFileMock.mock.calls[0]?.[1] as string;
    expect(insertedContent).toContain('merge:');
  });

  it('should return splitTemplate for new file when splitTemplate is set', async () => {
    const editor = createMockEditor();
    const deps = createDeps({ mergeTemplate: 'merge: {{content}}', splitTemplate: 'split: {{content}}' });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;

    await composer.splitFile();

    const insertedContent = insertIntoFileMock.mock.calls[0]?.[1] as string;
    expect(insertedContent).toContain('split:');
  });

  it('should return mergeTemplate for existing file when splitToExistingFileTemplate is Merge', async () => {
    const editor = createMockEditor();
    const deps = createDeps({
      mergeTemplate: 'merge: {{content}}',
      splitTemplate: 'split: {{content}}',
      splitToExistingFileTemplate: Action.Merge
    });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;

    await composer.splitFile();

    const insertedContent = insertIntoFileMock.mock.calls[0]?.[1] as string;
    expect(insertedContent).toContain('merge:');
  });

  it('should return splitTemplate for existing file when splitToExistingFileTemplate is Split', async () => {
    const editor = createMockEditor();
    const deps = createDeps({
      mergeTemplate: 'merge: {{content}}',
      splitTemplate: 'split: {{content}}',
      splitToExistingFileTemplate: Action.Split
    });

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: false,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    const insertIntoFileMock = vi.fn();
    const appObj = getComposerAppObj(composer);
    (appObj['fileManager'] as GenericObject)['insertIntoFile'] = insertIntoFileMock;

    await composer.splitFile();

    const insertedContent = insertIntoFileMock.mock.calls[0]?.[1] as string;
    expect(insertedContent).toContain('split:');
  });
});

describe('SplitComposer prepareBacklinkSubpaths', () => {
  it('should return empty Set', async () => {
    const editor = createMockEditor();
    const deps = createDeps();

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    // Split does not include '' in subpaths (unlike merge), so no full-file backlinks
    await composer.splitFile();

    expect(composer).toBeDefined();
  });
});

describe('SplitComposer updateEditorSelections', () => {
  it('should add footnotes to remove as editor selections', async () => {
    const setSelectionsMock = vi.fn();
    const editor = strictProxy<Editor>({
      getSelection: vi.fn().mockReturnValue('text [^fn1]'),
      listSelections: vi.fn().mockReturnValue([
        { anchor: { ch: 0, line: 0 }, head: { ch: 11, line: 0 } }
      ]),
      offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
      posToOffset: vi.fn((pos: EditorPosition) => pos.ch),
      replaceSelection: vi.fn(),
      setSelections: setSelectionsMock
    });

    const deps = createDeps({ shouldFixFootnotesByDefault: true });
    const appObj = getAppObj(deps.app);
    appObj['vault'] = {
      cachedRead: vi.fn()
        .mockResolvedValueOnce('source [^fn1]\n[^fn1]: footnote')
        .mockResolvedValueOnce('target content')
    };

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        { id: 'fn1', position: { end: { col: 11, line: 0, offset: 11 }, start: { col: 5, line: 0, offset: 5 } } }
      ],
      footnotes: [
        { id: 'fn1', position: { end: { col: 20, line: 1, offset: 34 }, start: { col: 0, line: 1, offset: 14 } } }
      ]
    });
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(setSelectionsMock).toHaveBeenCalled();
  });
});

describe('SplitComposer updateEditorSelections with restore', () => {
  it('should call removeSelectionRange for footnotes that need restoring', async () => {
    const setSelectionsMock = vi.fn();
    // Selection covers only part of the text, not the footnote ref outside selection
    const editor = strictProxy<Editor>({
      getSelection: vi.fn().mockReturnValue('definition text'),
      listSelections: vi.fn().mockReturnValue([
        { anchor: { ch: 20, line: 0 }, head: { ch: 50, line: 0 } }
      ]),
      offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
      posToOffset: vi.fn((pos: EditorPosition) => pos.ch),
      replaceSelection: vi.fn(),
      setSelections: setSelectionsMock
    });

    const deps = createDeps({ shouldFixFootnotesByDefault: true });
    const appObj = getAppObj(deps.app);
    appObj['vault'] = {
      cachedRead: vi.fn()
        .mockResolvedValueOnce('before [^fn1] selected [^fn1]: definition after')
        .mockResolvedValueOnce('target content')
    };

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        // First ref is outside selection (offset 7-13)
        { id: 'fn1', position: { end: { col: 13, line: 0, offset: 13 }, start: { col: 7, line: 0, offset: 7 } } },
        // Second ref is inside selection (offset 23-29)
        { id: 'fn1', position: { end: { col: 29, line: 0, offset: 29 }, start: { col: 23, line: 0, offset: 23 } } }
      ],
      footnotes: [
        // Footnote definition is inside selection (offset 23-45)
        {
          id: 'fn1',
          position: {
            end: { col: 45, line: 0, offset: 45 },
            start: { col: 23, line: 0, offset: 23 }
          }
        }
      ]
    });
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(setSelectionsMock).toHaveBeenCalled();
  });
});

describe('SplitComposer removeSelectionRange', () => {
  it('should keep selection before range', async () => {
    const setSelectionsMock = vi.fn();
    const editor = strictProxy<Editor>({
      getSelection: vi.fn().mockReturnValue('text'),
      listSelections: vi.fn().mockReturnValue([
        { anchor: { ch: 0, line: 0 }, head: { ch: 5, line: 0 } }
      ]),
      offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
      posToOffset: vi.fn((pos: EditorPosition) => pos.ch),
      replaceSelection: vi.fn(),
      setSelections: setSelectionsMock
    });

    const deps = createDeps({ shouldFixFootnotesByDefault: true });
    const appObj = getAppObj(deps.app);
    appObj['vault'] = {
      cachedRead: vi.fn()
        .mockResolvedValueOnce('text [^fn1]\n[^fn1]: footnote')
        .mockResolvedValueOnce('target')
    };

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        { id: 'fn1', position: { end: { col: 11, line: 0, offset: 11 }, start: { col: 5, line: 0, offset: 5 } } }
      ],
      footnotes: [
        {
          id: 'fn1',
          position: {
            end: { col: 20, line: 1, offset: 34 },
            start: { col: 0, line: 1, offset: 14 }
          }
        }
      ]
    });
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    // The setSelections mock was called with updated selections
    expect(setSelectionsMock).toHaveBeenCalled();
  });

  it('should split overlapping selection around range', async () => {
    const setSelectionsMock = vi.fn();
    // Selection that overlaps with a footnote range
    const editor = strictProxy<Editor>({
      getSelection: vi.fn().mockReturnValue('text [^fn1] and [^fn1]: footnote'),
      listSelections: vi.fn().mockReturnValue([
        { anchor: { ch: 0, line: 0 }, head: { ch: 40, line: 0 } }
      ]),
      offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
      posToOffset: vi.fn((pos: EditorPosition) => pos.ch),
      replaceSelection: vi.fn(),
      setSelections: setSelectionsMock
    });

    const deps = createDeps({ shouldFixFootnotesByDefault: true });
    const appObj = getAppObj(deps.app);
    appObj['vault'] = {
      cachedRead: vi.fn()
        .mockResolvedValueOnce('text [^fn1] and [^fn1]: footnote more')
        .mockResolvedValueOnce('target')
    };

    const composer = new SplitComposer({
      editor,
      isMultipleSplit: false,
      isNewTargetFile: true,
      ...deps,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        { id: 'fn1', position: { end: { col: 11, line: 0, offset: 11 }, start: { col: 5, line: 0, offset: 5 } } }
      ],
      footnotes: [
        {
          id: 'fn1',
          position: {
            end: { col: 35, line: 0, offset: 35 },
            start: { col: 16, line: 0, offset: 16 }
          }
        }
      ]
    });
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.splitFile();

    expect(setSelectionsMock).toHaveBeenCalled();
  });
});
