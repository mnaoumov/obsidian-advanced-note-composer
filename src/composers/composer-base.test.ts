import type {
  App as AppOriginal,
  CachedMetadata,
  Editor,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
import type { MockInstance } from 'vitest';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  getCacheSafe,
  getFrontmatterSafe
} from 'obsidian-dev-utils/obsidian/metadata-cache';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type {
  ComposerBaseConstructorParamsBase,
  Selection
} from './composer-base.ts';

import { InsertMode } from '../insert-mode.ts';
import {
  Action,
  FrontmatterMergeStrategy
} from '../plugin-settings.ts';
import {
  ComposerBase,
  getInsertModeFromEvent,
  getSelectionUnderHeading
} from './composer-base.ts';

interface CreateComposerOptions {
  readonly frontmatterMergeStrategy?: FrontmatterMergeStrategy;
  readonly insertMode?: InsertMode;
  readonly isNewTargetFile?: boolean;
  readonly settingsOverrides?: Partial<PluginSettings>;
  readonly shouldIncludeFrontmatter?: boolean;
  readonly shouldMergeHeadings?: boolean;
  readonly shouldShowNotice?: boolean;
}

interface TestComposerConstructorParams extends ComposerBaseConstructorParamsBase {
  readonly shouldIncludeFrontmatter?: boolean;
}

interface TestFileMtimes {
  readonly sourceMtime: number;
  readonly targetMtime: number;
}

// Return-value stubs for metadata-cache reads only: test-mocks has no metadata indexer, so getCacheSafe
// Would otherwise poll forever. Everything else (vault, lock, transaction, links, heading parsing) is REAL.
vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>(),
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

// UI-rendering helpers used only by the composer's notices — stub their return so link rendering does not
// Reach into unmocked App internals. Not the behavior under test.
vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

class TestComposer extends ComposerBase {
  public selectionsToReturn: Selection[] = [];
  public templateToReturn = '{{content}}';

  public constructor(params: TestComposerConstructorParams) {
    super({
      shouldIncludeFrontmatter: false,
      ...params
    });
  }

  public callBuildProgressContent(verb: string): Promise<DocumentFragment> {
    return this.buildProgressContent(verb);
  }

  public callCaptureFileMtimes(): TestFileMtimes {
    return this.captureFileMtimes();
  }

  public async callCheckFilesUnchanged(mtimes: TestFileMtimes): Promise<boolean> {
    return this.checkFilesUnchanged(mtimes);
  }

  public async callCheckTargetFileIgnored(): Promise<boolean> {
    return this.checkTargetFileIgnored(Action.Merge);
  }

  public async callInsertIntoTargetFile(content: string): Promise<void> {
    const vaultTransaction = new VaultTransaction({ app: this.app });
    await this.insertIntoTargetFile(content, vaultTransaction);
    await vaultTransaction.commit();
  }

  public callIsPathIgnored(path: string): boolean {
    return this.pluginSettingsComponent.settings.isPathIgnored(path);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Base class requires async.
  protected override async getSelections(): Promise<Selection[]> {
    return this.selectionsToReturn;
  }

  protected override getTemplate(): string {
    return this.templateToReturn;
  }

  protected override prepareBacklinkSubpaths(): Set<string> {
    return new Set(['']);
  }
}

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;
let showNoticeSpy: MockInstance;

beforeEach(() => {
  app = App.createConfigured__({
    files: {
      'source.md': 'source body',
      'target.md': 'target body'
    }
  }).asOriginalType__();
  // Test-mocks' MetadataCache is a strict proxy with no indexer; the frontmatter merge's processFrontMatter
  // And the heading-merge's parseMetadata both trigger a recompute, so stub it to a no-op.
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
});

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createComposer(options: CreateComposerOptions = {}): TestComposer {
  const composer = new TestComposer({
    app,
    isNewTargetFile: options.isNewTargetFile ?? false,
    pluginNoticeComponent: createPluginNoticeComponentStub(),
    pluginSettingsComponent: createPluginSettingsComponentStub(options.settingsOverrides),
    resourceLockComponent,
    sourceFile: getSourceFile(),
    targetFile: getTargetFile(),
    ...(options.frontmatterMergeStrategy === undefined ? {} : { frontmatterMergeStrategy: options.frontmatterMergeStrategy }),
    ...(options.insertMode === undefined ? {} : { insertMode: options.insertMode }),
    ...(options.shouldIncludeFrontmatter === undefined ? {} : { shouldIncludeFrontmatter: options.shouldIncludeFrontmatter }),
    ...(options.shouldMergeHeadings === undefined ? {} : { shouldMergeHeadings: options.shouldMergeHeadings }),
    ...(options.shouldShowNotice === undefined ? {} : { shouldShowNotice: options.shouldShowNotice })
  });
  return composer;
}

function createPluginNoticeComponentStub(): PluginNoticeComponent {
  const showNotice = vi.fn();
  showNoticeSpy = showNotice;
  return strictProxy<PluginNoticeComponent>({
    showNotice
  });
}

function createPluginSettingsComponentStub(overrides?: Partial<PluginSettings>): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({
      defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      isPathIgnored: () => false,
      mergeTemplate: '{{content}}',
      shouldFixFootnotesByDefault: false,
      shouldMergeHeadingsByDefault: false,
      shouldOpenNoteAfterMerge: false,
      shouldRunTemplaterOnDestinationFile: false,
      shouldUseSourceTitleWhenTargetHasNoTitle: false,
      ...overrides
    })
  });
}

function getSourceFile(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('source.md'));
}

function getTargetFile(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('target.md'));
}

function readTarget(): Promise<string> {
  return app.vault.adapter.read('target.md');
}

function stubProcessFrontMatter(seeded: GenericObject): void {
  vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation((_file, fn) => {
    fn(seeded);
    return noopAsync();
  });
}

function stubProcessFrontMatterNoop(): void {
  vi.spyOn(app.fileManager, 'processFrontMatter').mockResolvedValue();
}

describe('getInsertModeFromEvent', () => {
  it('should return Prepend when shift key is held', () => {
    const event = strictProxy<KeyboardEvent>({ shiftKey: true });
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Prepend);
  });

  it('should return Append when shift key is not held', () => {
    const event = strictProxy<KeyboardEvent>({ shiftKey: false });
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Append);
  });

  it('should return Append for mouse event without shift', () => {
    const event = strictProxy<MouseEvent>({ shiftKey: false });
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Append);
  });

  it('should return Prepend for mouse event with shift', () => {
    const event = strictProxy<MouseEvent>({ shiftKey: true });
    expect(getInsertModeFromEvent(event)).toBe(InsertMode.Prepend);
  });
});

describe('getSelectionUnderHeading', () => {
  function createMockApp(cache: CachedMetadata | null): AppOriginal {
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(cache);
    return app;
  }

  function createMockEditor(lines: string[]): Editor {
    return strictProxy<Editor>({
      getLine: vi.fn((n: number) => lines[n] ?? ''),
      lineCount: vi.fn(() => lines.length)
    });
  }

  it('should return null when no cache exists', () => {
    const mockApp = createMockApp(null);
    const editor = createMockEditor(['# Heading', 'text']);
    expect(getSelectionUnderHeading(mockApp, getSourceFile(), editor, 0)).toBeNull();
  });

  it('should return null when no heading at line number', () => {
    const mockApp = createMockApp({
      headings: [{
        heading: 'Heading',
        level: 1,
        position: { end: { col: 9, line: 0, offset: 9 }, start: { col: 0, line: 0, offset: 0 } }
      }]
    });
    const editor = createMockEditor(['# Heading', 'text', 'more text']);
    expect(getSelectionUnderHeading(mockApp, getSourceFile(), editor, 1)).toBeNull();
  });

  it('should return heading info when heading found at line', () => {
    const mockApp = createMockApp({
      headings: [{
        heading: 'Heading',
        level: 1,
        position: { end: { col: 9, line: 0, offset: 9 }, start: { col: 0, line: 0, offset: 0 } }
      }]
    });
    const editor = createMockEditor(['# Heading', 'text under heading', 'more text']);
    const result = getSelectionUnderHeading(mockApp, getSourceFile(), editor, 0);
    expect(result).not.toBeNull();
    expect(result?.heading).toBe('Heading');
    expect(result?.start.line).toBe(0);
    expect(result?.end.line).toBe(2);
  });

  it('should stop at next heading of same or higher level', () => {
    const mockApp = createMockApp({
      headings: [
        { heading: 'First', level: 2, position: { end: { col: 8, line: 0, offset: 8 }, start: { col: 0, line: 0, offset: 0 } } },
        { heading: 'Second', level: 2, position: { end: { col: 9, line: 3, offset: 30 }, start: { col: 0, line: 3, offset: 21 } } }
      ]
    });
    const editor = createMockEditor(['## First', 'content 1', '', '## Second', 'content 2']);
    const result = getSelectionUnderHeading(mockApp, getSourceFile(), editor, 0);
    expect(result).not.toBeNull();
    expect(result?.heading).toBe('First');
    expect(result?.end.line).toBe(1);
  });

  it('should skip trailing empty lines before next heading', () => {
    const mockApp = createMockApp({
      headings: [
        { heading: 'First', level: 1, position: { end: { col: 7, line: 0, offset: 7 }, start: { col: 0, line: 0, offset: 0 } } },
        { heading: 'Second', level: 1, position: { end: { col: 8, line: 4, offset: 30 }, start: { col: 0, line: 4, offset: 22 } } }
      ]
    });
    const editor = createMockEditor(['# First', 'content', '', '', '# Second']);
    const result = getSelectionUnderHeading(mockApp, getSourceFile(), editor, 0);
    expect(result).not.toBeNull();
    expect(result?.end.line).toBe(1);
  });

  it('should include sub-headings in selection', () => {
    const mockApp = createMockApp({
      headings: [
        { heading: 'Parent', level: 1, position: { end: { col: 8, line: 0, offset: 8 }, start: { col: 0, line: 0, offset: 0 } } },
        { heading: 'Child', level: 2, position: { end: { col: 8, line: 2, offset: 20 }, start: { col: 0, line: 2, offset: 12 } } }
      ]
    });
    const editor = createMockEditor(['# Parent', 'text', '## Child', 'child text']);
    const result = getSelectionUnderHeading(mockApp, getSourceFile(), editor, 0);
    expect(result).not.toBeNull();
    expect(result?.end.line).toBe(3);
  });

  it('should handle cache without headings', () => {
    const mockApp = createMockApp({});
    const editor = createMockEditor(['text']);
    expect(getSelectionUnderHeading(mockApp, getSourceFile(), editor, 0)).toBeNull();
  });
});

describe('ComposerBase constructor', () => {
  it('should use defaults from settings when optional values are not provided', () => {
    const composer = createComposer();
    expect(composer).toBeDefined();
  });

  it('should use explicit option values when provided', () => {
    const composer = createComposer({
      frontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter,
      insertMode: InsertMode.Prepend,
      isNewTargetFile: true,
      shouldIncludeFrontmatter: true,
      shouldMergeHeadings: true,
      shouldShowNotice: false
    });
    expect(composer).toBeDefined();
  });
});

describe('buildProgressContent', () => {
  it('should build a fragment describing the operation from source to target', async () => {
    const composer = createComposer();
    const fragment = await composer.callBuildProgressContent('Merging');
    expect(fragment.textContent).toContain('Merging note');
    expect(fragment.textContent).toContain('into');
  });
});

describe('captureFileMtimes / checkFilesUnchanged', () => {
  it('should report the files as unchanged when the mtimes match', async () => {
    const composer = createComposer();
    const mtimes = composer.callCaptureFileMtimes();
    expect(await composer.callCheckFilesUnchanged(mtimes)).toBe(true);
    expect(showNoticeSpy).not.toHaveBeenCalled();
  });

  it('should report a change and show a notice when a file was modified', async () => {
    const composer = createComposer();
    const mtimes = composer.callCaptureFileMtimes();
    // Simulate an external edit: bump the source note's mtime after the capture.
    getSourceFile().stat.mtime += 1000;
    expect(await composer.callCheckFilesUnchanged(mtimes)).toBe(false);
    expect(showNoticeSpy).toHaveBeenCalledOnce();
  });
});

describe('checkTargetFileIgnored', () => {
  it('should show a notice and return false when the target path is ignored', async () => {
    const composer = createComposer({ settingsOverrides: { isPathIgnored: () => true } });
    expect(await composer.callCheckTargetFileIgnored()).toBe(false);
    expect(showNoticeSpy).toHaveBeenCalledOnce();
  });

  it('should return true when the target path is not ignored', async () => {
    const composer = createComposer({ settingsOverrides: { isPathIgnored: () => false } });
    expect(await composer.callCheckTargetFileIgnored()).toBe(true);
  });
});

describe('isPathIgnored', () => {
  it('should delegate to the settings isPathIgnored predicate', () => {
    const composer = createComposer({ settingsOverrides: { isPathIgnored: (path) => path === 'some/path.md' } });
    expect(composer.callIsPathIgnored('some/path.md')).toBe(true);
    expect(composer.callIsPathIgnored('other.md')).toBe(false);
  });
});

describe('insertIntoTargetFile', () => {
  it('should append the inserted content to the target when not merging headings', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('APPENDED_CONTENT');

    expect(await readTarget()).toBe('target bodyAPPENDED_CONTENT');
  });

  it('should insert the content after the frontmatter when the insert mode is Prepend', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ insertMode: InsertMode.Prepend });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('PREPENDED_CONTENT');

    expect(await readTarget()).toBe('PREPENDED_CONTENTtarget body');
  });

  it('should merge the content heading-by-heading when merging headings is enabled', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ shouldMergeHeadings: true });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('MERGE_HEADINGS_CONTENT');

    expect(await readTarget()).toContain('MERGE_HEADINGS_CONTENT');
    expect(await readTarget()).toContain('target body');
  });

  it('should prepend a newline when the template content starts with a frontmatter delimiter', async () => {
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    composer.templateToReturn = '---\nfoo: bar\n---\n{{content}}';

    await composer.callInsertIntoTargetFile('body');

    expect(await readTarget()).toMatch(/\n---\nfoo: bar/);
  });
});

describe('includeFrontmatter', () => {
  it('should leave the content unchanged when including frontmatter is disabled', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer();
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 50 }];

    await composer.callInsertIntoTargetFile('BODY_CONTENT');

    expect(await readTarget()).toBe('target bodyBODY_CONTENT');
  });

  it('should leave the content unchanged when the source has no includable frontmatter', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ shouldIncludeFrontmatter: true });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 50 }];
    vi.mocked(getCacheSafe).mockResolvedValue(null);

    await composer.callInsertIntoTargetFile('BODY_CONTENT');

    expect(await readTarget()).toBe('target bodyBODY_CONTENT');
  });

  it('should prepend the source frontmatter when including frontmatter and it is includable', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ shouldIncludeFrontmatter: true });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 50 }];
    vi.mocked(getCacheSafe).mockResolvedValue(castTo<CachedMetadata>({
      frontmatter: { key: 'value' },
      frontmatterPosition: { end: { col: 0, line: 3, offset: 30 }, start: { col: 0, line: 0, offset: 0 } }
    }));

    await composer.callInsertIntoTargetFile('BODY_CONTENT');

    // The source frontmatter was extracted from the prepended content and merged into the target.
    expect(seeded).toEqual({ key: 'value' });
  });
});

describe('fixFootnotes', () => {
  it('should leave footnote references untouched when fixing footnotes is disabled', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ settingsOverrides: { shouldFixFootnotesByDefault: false } });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('text with [^1] footnote');

    expect(await readTarget()).toContain('[^1]');
  });

  it('should rename a duplicated footnote id that already exists in the target', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ settingsOverrides: { shouldFixFootnotesByDefault: true } });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.spyOn(app.vault, 'cachedRead')
      .mockResolvedValueOnce('source [^fn1] and [^fn1] again')
      .mockResolvedValueOnce('target [^fn1]');
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        { id: 'fn1', position: { end: { col: 13, line: 0, offset: 13 }, start: { col: 7, line: 0, offset: 7 } } },
        { id: 'fn1', position: { end: { col: 27, line: 0, offset: 27 }, start: { col: 18, line: 0, offset: 18 } } }
      ],
      footnotes: []
    });

    await composer.callInsertIntoTargetFile('text [^fn1] and [^fn1] again');

    // The source id collides with the target's existing [^fn1], so it is renamed to [^fn1-1].
    expect(await readTarget()).toContain('[^fn1-1]');
  });

  it('should keep a fresh footnote id and skip refs outside the selection', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ settingsOverrides: { shouldFixFootnotesByDefault: true } });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.spyOn(app.vault, 'cachedRead')
      .mockResolvedValueOnce('source [^uniq]')
      .mockResolvedValueOnce('target with no footnotes');
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        { id: 'uniq', position: { end: { col: 11, line: 0, offset: 11 }, start: { col: 5, line: 0, offset: 5 } } },
        { id: 'other', position: { end: { col: 7, line: 5, offset: 207 }, start: { col: 0, line: 5, offset: 200 } } }
      ],
      footnotes: []
    });

    await composer.callInsertIntoTargetFile('text [^uniq]');

    // The id does not collide with the target, so it is kept as-is.
    expect(await readTarget()).toContain('[^uniq]');
  });
});

describe('mergeFrontmatter strategies', () => {
  it('should union arrays with unique values for MergeAndPreferNewValues', async () => {
    const seeded: GenericObject = { existingKey: 'old' };
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ tags: ['a', 'b'] });

    await composer.callInsertIntoTargetFile('---\ntags:\n  - b\n  - c\n---\ncontent');

    expect(seeded).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('should merge nested objects recursively for MergeAndPreferNewValues', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ nested: { a: 1 } });

    await composer.callInsertIntoTargetFile('---\nnested:\n  b: 2\n---\ncontent');

    expect(seeded).toEqual({ nested: { a: 1, b: 2 } });
  });

  it('should replace a null original value with the new value for MergeAndPreferNewValues', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ key: null });

    await composer.callInsertIntoTargetFile('---\nkey: new-value\n---\ncontent');

    expect(seeded).toEqual({ key: 'new-value' });
  });

  it('should add a brand-new key that is absent from the original for MergeAndPreferNewValues', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.callInsertIntoTargetFile('---\nfresh: value\n---\ncontent');

    expect(seeded).toEqual({ fresh: 'value' });
  });

  it('should keep the original scalar value for MergeAndPreferOriginalValues', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferOriginalValues });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ key: 'original' });

    await composer.callInsertIntoTargetFile('---\nkey: new\n---\ncontent');

    expect(seeded).toEqual({ key: 'original' });
  });

  it('should nest both frontmatters under generated keys for PreserveBothOriginalAndNewFrontmatter', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ existingKey: 'old' });

    await composer.callInsertIntoTargetFile('---\nfoo: bar\n---\ncontent');

    // The original key is preserved and the new frontmatter is nested under a generated __merged key.
    expect(seeded['existingKey']).toBe('old');
    expect(Object.keys(seeded).some((key) => key.startsWith('__merged'))).toBe(true);
  });

  it('should replace with the new frontmatter for ReplaceWithNewFrontmatter', async () => {
    const seeded: GenericObject = { existingKey: 'old' };
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ existingKey: 'old' });

    await composer.callInsertIntoTargetFile('---\nnewKey: new\n---\ncontent');

    // The original key does not survive the replace strategy.
    expect(seeded['existingKey']).toBeUndefined();
  });

  it('should skip the frontmatter merge entirely for KeepOriginalFrontmatter', async () => {
    const spy = vi.spyOn(app.fileManager, 'processFrontMatter').mockResolvedValue();
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('content');

    expect(spy).not.toHaveBeenCalled();
  });

  it('should preserve the original title when it is defined', async () => {
    const seeded: GenericObject = { existingKey: 'old' };
    stubProcessFrontMatter(seeded);
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({ title: 'Original Title' });

    await composer.callInsertIntoTargetFile('---\ntitle: New Title\n---\ncontent');

    expect(seeded['title']).toBe('Original Title');
  });

  it('should discard the source title when the target has no title and the setting is off', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      settingsOverrides: { shouldUseSourceTitleWhenTargetHasNoTitle: false }
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.callInsertIntoTargetFile('---\ntitle: New Title\n---\ncontent');

    expect(seeded['title']).toBeUndefined();
  });

  it('should use the source title when the target has no title and the setting is on', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      settingsOverrides: { shouldUseSourceTitleWhenTargetHasNoTitle: true }
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.callInsertIntoTargetFile('---\ntitle: New Title\n---\ncontent');

    expect(seeded['title']).toBe('New Title');
  });

  it('should not add a title when neither target nor source has one and the setting is on', async () => {
    const seeded: GenericObject = {};
    stubProcessFrontMatter(seeded);
    const composer = createComposer({
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      settingsOverrides: { shouldUseSourceTitleWhenTargetHasNoTitle: true }
    });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.callInsertIntoTargetFile('---\nfoo: bar\n---\ncontent');

    expect(seeded['title']).toBeUndefined();
  });
});

describe('safeParseFrontmatter', () => {
  it('should keep the whole content when the frontmatter YAML is invalid', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('---\n: invalid: yaml: [[\n---\ncontent');

    // The parse failure resets contentStart to 0, so the raw invalid block is kept in the inserted body.
    expect(await readTarget()).toContain(': invalid: yaml');
  });

  it('should treat empty frontmatter as an empty object', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('---\n---\ncontent');

    expect(await readTarget()).toContain('content');
  });

  it('should parse valid frontmatter and insert the body', async () => {
    stubProcessFrontMatterNoop();
    const composer = createComposer({ frontmatterMergeStrategy: FrontmatterMergeStrategy.ReplaceWithNewFrontmatter });
    composer.selectionsToReturn = [{ endOffset: 100, startOffset: 0 }];

    await composer.callInsertIntoTargetFile('---\nkey: value\n---\nbody content');

    expect(await readTarget()).toContain('body content');
  });
});
