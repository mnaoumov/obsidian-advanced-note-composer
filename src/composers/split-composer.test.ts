import type {
  App as AppOriginal,
  Editor,
  EditorPosition,
  EditorSelection,
  MarkdownView,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import {
  castTo,
  normalizeOptionalProperties
} from 'obsidian-dev-utils/object-utils';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { resolveValue } from 'obsidian-dev-utils/value-provider';
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
import type { Selection } from './composer-base.ts';

import { InsertMode } from '../insert-mode.ts';
import {
  Action,
  FrontmatterMergeStrategy,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import {
  getSelections,
  SplitComposer
} from './split-composer.ts';

interface AbortableComposer {
  readonly abortController: AbortController;
}

interface CreateComposerOptions {
  readonly capturedSelections?: Selection[];
  readonly consoleDebugComponent?: ConsoleDebugComponent;
  readonly editor?: Editor;
  readonly insertToken?: string;
  readonly isMultipleSplit?: boolean;
  readonly isNewTargetFile?: boolean;
  readonly pluginNoticeComponent?: PluginNoticeComponent;
  readonly selectedText?: string;
  readonly settingsOverrides?: Partial<PluginSettings>;
  readonly shouldIncludeFrontmatter?: boolean;
  readonly targetCursorOffset?: number;
}

interface EditorDoubleOptions {
  readonly listSelections?: EditorSelection[];
}

interface MockPosition {
  readonly ch: number;
}

interface OptionalComposerParams {
  readonly insertToken?: string;
  readonly shouldIncludeFrontmatter?: boolean;
  readonly targetCursorOffset?: number;
}

interface SameNoteComposerParams {
  readonly capturedSelections: Selection[];
  readonly insertMode: InsertMode;
  readonly pluginNoticeComponent?: PluginNoticeComponent;
  readonly targetCursorOffset?: number;
}

// Return-value stubs for metadata-cache reads only: test-mocks has no metadata indexer, so getCacheSafe
// Would otherwise poll forever. Everything else (vault, lock, transaction, links) is REAL.
vi.mock(
  'obsidian-dev-utils/obsidian/metadata-cache',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('obsidian-dev-utils/obsidian/metadata-cache')
    >()),
    getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
    getCacheSafe: vi.fn().mockResolvedValue(null),
    getFrontmatterSafe: vi.fn().mockResolvedValue({})
  })
);

// UI-rendering helpers used only by the composer's notices — stub their return so link rendering does not
// Reach into unmocked App internals (embedRegistry). Not the behavior under test.
vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi
    .fn()
    .mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
      const fragment = createFragment();
      return cb(fragment).then(() => fragment);
    })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

beforeEach(() => {
  app = App.createConfigured__({
    files: {
      'source.md': 'source body',
      'target.md': 'target body'
    }
  }).asOriginalType__();
  // Test-mocks' MetadataCache is a strict proxy with no indexer; the frontmatter merge's
  // ProcessFrontMatter triggers a recompute, so stub it to a no-op.
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
});

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createComposer(options?: CreateComposerOptions): SplitComposer {
  const editor = options?.editor ?? createEditorDouble();
  return new SplitComposer({
    app,
    capturedSelections: options?.capturedSelections ?? getSelections(editor),
    consoleDebugComponent: options?.consoleDebugComponent
      ?? strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    editor,
    isMultipleSplit: options?.isMultipleSplit ?? false,
    isNewTargetFile: options?.isNewTargetFile ?? true,
    pluginNoticeComponent: options?.pluginNoticeComponent ?? createPluginNoticeComponentStub(),
    pluginSettingsComponent: createPluginSettingsComponentStub(options?.settingsOverrides),
    resourceLockComponent,
    selectedText: options?.selectedText ?? 'selected text',
    sourceFile: getSourceFile(),
    targetFile: getTargetFile(),
    ...optionalComposerParams(options)
  });
}

function createEditorDouble(options?: EditorDoubleOptions): Editor {
  const selections = options?.listSelections ?? [
    { anchor: { ch: 0, line: 0 }, head: { ch: 11, line: 0 } }
  ];
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: 0 }),
    getSelection: vi.fn().mockReturnValue('LIVE-EDITOR-SELECTION'),
    listSelections: vi.fn().mockReturnValue(selections),
    offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
    posToOffset: vi.fn((pos: MockPosition) => pos.ch),
    replaceSelection: vi.fn(),
    setSelections: vi.fn()
  });
}

function createPluginNoticeComponentStub(
  disposeMock: () => void = vi.fn()
): PluginNoticeComponent {
  return strictProxy<PluginNoticeComponent>({
    showNotice: vi.fn(),
    showNoticeAfterDelay: vi
      .fn()
      .mockReturnValue({ setContent: vi.fn(), [Symbol.dispose]: disposeMock })
  });
}

function createPluginSettingsComponentStub(
  overrides?: Partial<PluginSettings>
): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({
      defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      isPathIgnored: () => false,
      mergeTemplate: '{{content}}',
      shouldApplyTextAfterExtractionToSameFile: false,
      shouldFixFootnotesByDefault: false,
      shouldIncludeFrontmatterWhenSplittingByDefault: false,
      shouldMergeHeadingsByDefault: false,
      shouldOpenTargetNoteAfterSplit: false,
      shouldRunTemplaterOnDestinationFile: false,
      shouldUseSourceTitleWhenTargetHasNoTitle: false,
      splitTemplate: '',
      splitToExistingFileTemplate: Action.Split,
      textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile,
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

// Only the composer params that must be omitted (not passed as `undefined`) under
// `exactOptionalPropertyTypes` when the test does not set them. Extracted to keep `createComposer`
// Below the cyclomatic-complexity limit.
function optionalComposerParams(options?: CreateComposerOptions): OptionalComposerParams {
  return normalizeOptionalProperties<OptionalComposerParams>({
    insertToken: options?.insertToken,
    shouldIncludeFrontmatter: options?.shouldIncludeFrontmatter,
    targetCursorOffset: options?.targetCursorOffset
  });
}

describe('getSelections', () => {
  interface MockSelection {
    readonly anchor: number;
    readonly head: number;
  }

  function createMockEditorForGetSelections(
    selections: MockSelection[]
  ): Editor {
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
    const editor = createMockEditorForGetSelections([{ anchor: 30, head: 10 }]);

    const result = getSelections(editor);
    expect(result[0]?.startOffset).toBe(10);
    expect(result[0]?.endOffset).toBe(30);
  });

  it('should handle single selection', () => {
    const editor = createMockEditorForGetSelections([{ anchor: 5, head: 15 }]);

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
    const composer = createComposer({ shouldIncludeFrontmatter: true });
    expect(composer).toBeDefined();
  });

  it('should use the default from settings when shouldIncludeFrontmatter is not provided', () => {
    const composer = createComposer({
      settingsOverrides: {
        shouldIncludeFrontmatterWhenSplittingByDefault: true
      }
    });
    expect(composer).toBeDefined();
  });
});

describe('splitFile', () => {
  it('should not touch the vault when the target path is ignored', async () => {
    const editor = createEditorDouble();
    await createComposer({
      editor,
      settingsOverrides: { isPathIgnored: () => true }
    }).splitFile();

    // Nothing was extracted: the target keeps its original content and the source editor was untouched.
    expect(await app.vault.adapter.read('target.md')).toBe('target body');
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });

  it('should extract the captured selectedText, never the live (possibly rebound) editor selection', async () => {
    // Regression for the file-switch corruption: the leaf may navigate away during the modal, rebinding
    // The composer's `editor` to another note. The composer must use the captured text and never re-read
    // `editor.getSelection()`.
    const editor = createEditorDouble();
    const composer = createComposer({
      capturedSelections: [{ endOffset: 14, startOffset: 0 }],
      editor,
      selectedText: 'CAPTURED-CONTENT',
      settingsOverrides: {
        textAfterExtractionMode: TextAfterExtractionMode.None
      }
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).toContain('CAPTURED-CONTENT');
    expect(targetContent).not.toContain('LIVE-EDITOR-SELECTION');
    expect(editor.getSelection).not.toHaveBeenCalled();
  });

  it('should insert the extracted content and replace the selection with a link for LinkToNewFile mode', async () => {
    vi.spyOn(app.fileManager, 'generateMarkdownLink').mockReturnValue(
      '[[target]]'
    );
    const editor = createEditorDouble();
    const composer = createComposer({
      editor,
      settingsOverrides: {
        textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain(
      'selected text'
    );
    expect(editor.replaceSelection).toHaveBeenCalledWith('[[target]]');
  });

  it('should replace the selection with an embed for EmbedNewFile mode', async () => {
    vi.spyOn(app.fileManager, 'generateMarkdownLink').mockReturnValue(
      '[[target]]'
    );
    const editor = createEditorDouble();
    const composer = createComposer({
      editor,
      settingsOverrides: {
        textAfterExtractionMode: TextAfterExtractionMode.EmbedNewFile
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain(
      'selected text'
    );
    expect(editor.replaceSelection).toHaveBeenCalledWith('![[target]]');
  });

  it('should replace the selection with an empty string for None mode', async () => {
    const editor = createEditorDouble();
    const composer = createComposer({
      editor,
      settingsOverrides: {
        textAfterExtractionMode: TextAfterExtractionMode.None
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain(
      'selected text'
    );
    expect(editor.replaceSelection).toHaveBeenCalledWith('');
  });

  it('should throw and roll back the target for an invalid textAfterExtractionMode', async () => {
    const editor = createEditorDouble();
    const composer = createComposer({
      editor,
      settingsOverrides: {
        textAfterExtractionMode: castTo<TextAfterExtractionMode>('invalid')
      }
    });

    await expect(composer.splitFile()).rejects.toThrow(
      'Invalid text after extraction mode'
    );

    // The insert happened before the throw; the transaction rolls the target back to its original content.
    expect(await app.vault.adapter.read('target.md')).toBe('target body');
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });

  it('should abort the split and leave the target unchanged when a file is modified during the operation', async () => {
    // Bump the source mtime after the capture (the first body statement is the console-debug call) but
    // Before the unchanged re-check, simulating an external edit mid-operation.
    const sourceFile = getSourceFile();
    const consoleDebugComponent = strictProxy<ConsoleDebugComponent>({
      consoleDebug: vi.fn(() => {
        sourceFile.stat.mtime += 1;
      })
    });
    const editor = createEditorDouble();
    const composer = createComposer({ consoleDebugComponent, editor });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toBe('target body');
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });

  it('should swallow the cancellation and roll back when aborted mid-operation', async () => {
    // A failing operation whose abort flag is set is treated as a user cancellation: the thrown error is
    // Swallowed (resolves, not rejects) and the transaction rolls the vault back. The invalid mode makes
    // The body throw AFTER the target insert, so the rollback must restore the target.
    const editor = createEditorDouble();
    const composer = createComposer({
      editor,
      settingsOverrides: {
        textAfterExtractionMode: castTo<TextAfterExtractionMode>('invalid')
      }
    });
    // Simulate the user clicking the lock indicator's Unlock mid-operation.
    castTo<AbortableComposer>(composer).abortController.abort();

    await expect(composer.splitFile()).resolves.toBeUndefined();

    // Rolled back: the target keeps its original content and the source editor was never mutated.
    expect(await app.vault.adapter.read('target.md')).toBe('target body');
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });

  it('should show a progress notice for a single split and close it afterwards', async () => {
    const disposeMock = vi.fn();
    const pluginNoticeComponent = createPluginNoticeComponentStub(disposeMock);
    const composer = createComposer({ pluginNoticeComponent });

    await composer.splitFile();

    const showNoticeAfterDelayMock = vi.mocked(
      pluginNoticeComponent.showNoticeAfterDelay
    );
    expect(showNoticeAfterDelayMock).toHaveBeenCalledTimes(1);
    const params = showNoticeAfterDelayMock.mock.calls[0]?.[0];
    expect(params?.abortController).toBeInstanceOf(AbortController);
    const content = await resolveValue(ensureNonNullable(params?.content), {});
    expect(castTo<DocumentFragment>(content).textContent).toContain(
      'Splitting note'
    );
    expect(disposeMock).toHaveBeenCalled();
  });

  it('should not show a progress notice for a multiple split', async () => {
    const pluginNoticeComponent = createPluginNoticeComponentStub();
    const composer = createComposer({
      isMultipleSplit: true,
      pluginNoticeComponent
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain(
      'selected text'
    );
    expect(
      vi.mocked(pluginNoticeComponent.showNoticeAfterDelay)
    ).not.toHaveBeenCalled();
  });

  it('should reveal the cursor in the re-opened source view so the viewport is not left at the top', async () => {
    // Re-opening the source note scrolls the editor to the top; the fix reveals the cursor's line.
    const reOpenedEditor = createEditorDouble();
    vi.mocked(reOpenedEditor.getCursor).mockReturnValue({ ch: 3, line: 42 });
    const setEphemeralStateMock = vi.fn();
    // `file: null` keeps the resource lock's status-bar reconcile (which also calls getActiveViewOfType)
    // From resolving a lock owner, so it early-returns instead of reaching into the view's containerEl.
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        editor: reOpenedEditor,
        file: null,
        setEphemeralState: setEphemeralStateMock
      })
    );

    const composer = createComposer({
      capturedSelections: [{ endOffset: 10, startOffset: 0 }],
      editor: createEditorDouble(),
      settingsOverrides: {
        textAfterExtractionMode: TextAfterExtractionMode.None
      }
    });

    await composer.splitFile();

    expect(setEphemeralStateMock).toHaveBeenCalledWith({ line: 42 });
  });

  it('should open the target note after a single split when shouldOpenTargetNoteAfterSplit is true', async () => {
    const composer = createComposer({
      settingsOverrides: { shouldOpenTargetNoteAfterSplit: true }
    });

    await composer.splitFile();

    expect(app.workspace.getActiveFile()?.path).toBe('target.md');
  });

  it('should not open the target note when the split is a multiple split', async () => {
    const composer = createComposer({
      isMultipleSplit: true,
      settingsOverrides: { shouldOpenTargetNoteAfterSplit: true }
    });

    await composer.splitFile();

    // No leaf was ever activated, so there is no active file.
    expect(app.workspace.getActiveFile()).toBeNull();
  });
});

describe('splitFile move mode', () => {
  it('should insert the moved content at the cursor token for a cross-file move and open the target', async () => {
    const editor = createEditorDouble();
    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor,
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        // `shouldMergeHeadingsByDefault: true` proves the token flow still takes the positional-insert
        // Path (it never heading-merges), and KeepOriginalFrontmatter isolates the inserted content.
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        shouldMergeHeadingsByDefault: true,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      targetCursorOffset: 7
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).not.toContain('TK');
    expect(targetContent.indexOf('MOVED')).toBe(7);
    expect(editor.replaceSelection).toHaveBeenCalledWith('');
    expect(app.workspace.getActiveFile()?.path).toBe('target.md');
  });

  it('should shift the captured selection offsets by the token length for a same-note move before the cursor', async () => {
    const editor = createEditorDouble();
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        editor,
        file: null,
        setEphemeralState: vi.fn()
      })
    );
    const sourceFile = getSourceFile();
    const composer = new SplitComposer({
      app,
      capturedSelections: [{ endOffset: 11, startOffset: 7 }],
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
      editor,
      insertToken: 'TK',
      isMultipleSplit: false,
      isNewTargetFile: false,
      pluginNoticeComponent: createPluginNoticeComponentStub(),
      pluginSettingsComponent: createPluginSettingsComponentStub({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      }),
      resourceLockComponent,
      selectedText: 'MOVED',
      sourceFile,
      targetCursorOffset: 0,
      targetFile: sourceFile
    });

    await composer.splitFile();

    // Token 'TK' (length 2) inserted at offset 0 shifts the captured selection [7,11) to [9,13), so the
    // Re-opened source restores the shifted range and removes the originally-marked text.
    expect(editor.setSelections).toHaveBeenCalledWith([
      { anchor: { ch: 9, line: 0 }, head: { ch: 13, line: 0 } }
    ]);
    const content = await app.vault.adapter.read('source.md');
    expect(content.indexOf('MOVED')).toBe(0);
    expect(content).not.toContain('TK');
  });

  it('should not shift the captured selection offsets for a same-note move after the cursor', async () => {
    const editor = createEditorDouble();
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        editor,
        file: null,
        setEphemeralState: vi.fn()
      })
    );
    const sourceFile = getSourceFile();
    const composer = new SplitComposer({
      app,
      capturedSelections: [{ endOffset: 6, startOffset: 0 }],
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
      editor,
      insertToken: 'TK',
      isMultipleSplit: false,
      isNewTargetFile: false,
      pluginNoticeComponent: createPluginNoticeComponentStub(),
      pluginSettingsComponent: createPluginSettingsComponentStub({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      }),
      resourceLockComponent,
      selectedText: 'MOVED',
      sourceFile,
      targetCursorOffset: 11,
      targetFile: sourceFile
    });

    await composer.splitFile();

    // The cursor (offset 11) is after the selection [0,6), so the offsets are restored unchanged.
    expect(editor.setSelections).toHaveBeenCalledWith([
      { anchor: { ch: 0, line: 0 }, head: { ch: 6, line: 0 } }
    ]);
    const content = await app.vault.adapter.read('source.md');
    expect(content.indexOf('MOVED')).toBe(11);
  });
});

describe('splitFile same-note extract', () => {
  function createSameNoteComposer(params: SameNoteComposerParams): SplitComposer {
    const editor = createEditorDouble();
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        editor,
        file: null,
        setEphemeralState: vi.fn()
      })
    );
    const sourceFile = getSourceFile();
    return new SplitComposer({
      app,
      capturedSelections: params.capturedSelections,
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
      editor,
      insertMode: params.insertMode,
      isMultipleSplit: false,
      isNewTargetFile: false,
      pluginNoticeComponent: params.pluginNoticeComponent ?? createPluginNoticeComponentStub(),
      pluginSettingsComponent: createPluginSettingsComponentStub({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        shouldFixFootnotesByDefault: true,
        shouldIncludeFrontmatterWhenSplittingByDefault: true
      }),
      resourceLockComponent,
      selectedText: 'MOVED',
      sourceFile,
      targetFile: sourceFile,
      ...normalizeOptionalProperties<OptionalComposerParams>({ targetCursorOffset: params.targetCursorOffset })
    });
  }

  it('should synthesize a move token and append the selection to the bottom of the same note', async () => {
    // No `insertToken` and no `targetCursorOffset`: the constructor synthesizes a token and the offset
    // Is derived from `insertMode` (Append = end of note). 'source body' is 11 chars, selection [0,6).
    const composer = createSameNoteComposer({
      capturedSelections: [{ endOffset: 6, startOffset: 0 }],
      insertMode: InsertMode.Append
    });

    await composer.splitFile();

    const content = await app.vault.adapter.read('source.md');
    // 'source' cut from the front and appended to the end, exactly once, no synthesized token left behind.
    expect(content.match(/MOVED/g)?.length).toBe(1);
    expect(content.trimEnd().endsWith('MOVED')).toBe(true);
    expect(content).not.toContain('advanced-note-composer-move-');
  });

  it('should derive the top offset from prepend and place the selection after any frontmatter', async () => {
    // No frontmatter, so the top offset is 0; selection [7,11) ('body') is after it and shifts by the
    // Token length, so the re-opened source removes it and the moved content lands at the top.
    const composer = createSameNoteComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 7 }],
      insertMode: InsertMode.Prepend
    });

    await composer.splitFile();

    const content = await app.vault.adapter.read('source.md');
    expect(content.indexOf('MOVED')).toBe(0);
    expect(content).not.toContain('advanced-note-composer-move-');
  });

  it('should abort with a notice when the derived insert point falls inside the moved selection', async () => {
    const pluginNoticeComponent = createPluginNoticeComponentStub();
    // A pinned offset (7) strictly inside the captured selection [0,11): the token would be removed with
    // The source. The move aborts and nothing is written.
    const composer = createSameNoteComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      insertMode: InsertMode.Append,
      pluginNoticeComponent,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(pluginNoticeComponent.showNotice).toHaveBeenCalledWith(expect.stringContaining('frontmatter'));
    const content = await app.vault.adapter.read('source.md');
    expect(content).toBe('source body');
    expect(castTo<AbortableComposer>(composer).abortController.signal.aborted).toBe(true);
  });
});

describe('SplitComposer getTemplate', () => {
  it('should use the merge template when the split template is empty', async () => {
    const composer = createComposer({
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        splitTemplate: ''
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain('merge:');
  });

  it('should use the split template for a new file when the split template is set', async () => {
    const composer = createComposer({
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        splitTemplate: 'split: {{content}}'
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain('split:');
  });

  it('should use the merge template for an existing file when splitToExistingFileTemplate is Merge', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        splitTemplate: 'split: {{content}}',
        splitToExistingFileTemplate: Action.Merge
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain('merge:');
  });

  it('should use the split template for an existing file when splitToExistingFileTemplate is Split', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        splitTemplate: 'split: {{content}}',
        splitToExistingFileTemplate: Action.Split
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain('split:');
  });
});

describe('SplitComposer prepareBacklinkSubpaths', () => {
  it('should not add the whole-file subpath, so only extracted headings/blocks get backlinks fixed', async () => {
    // Split (unlike merge) returns an empty subpath set, so a full-file backlink is not rewritten.
    const composer = createComposer();

    await composer.splitFile();

    // The split still completes, inserting the extracted content into the target.
    expect(await app.vault.adapter.read('target.md')).toContain(
      'selected text'
    );
  });
});

describe('SplitComposer updateEditorSelections', () => {
  it('should add the removed footnotes as editor selections', async () => {
    const setSelectionsMock = vi.fn();
    const editor = strictProxy<Editor>({
      getCursor: vi.fn().mockReturnValue({ ch: 0, line: 0 }),
      listSelections: vi
        .fn()
        .mockReturnValue([
          { anchor: { ch: 0, line: 0 }, head: { ch: 11, line: 0 } }
        ]),
      offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
      posToOffset: vi.fn((pos: EditorPosition) => pos.ch),
      replaceSelection: vi.fn(),
      setSelections: setSelectionsMock
    });
    vi.spyOn(app.vault, 'cachedRead')
      .mockResolvedValueOnce('source [^fn1]\n[^fn1]: footnote')
      .mockResolvedValueOnce('target content');
    // Fn1's only ref is inside the selection (offset 0-11), so fn1 is copied and then removed from the
    // Source, adding its definition range as a removal selection. fn2's ref and definition are both
    // Outside the selection, so fn2 is neither removed nor restored (exercising the skip branch).
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        {
          id: 'fn1',
          position: {
            end: { col: 11, line: 0, offset: 11 },
            start: { col: 5, line: 0, offset: 5 }
          }
        },
        {
          id: 'fn2',
          position: {
            end: { col: 6, line: 5, offset: 106 },
            start: { col: 0, line: 5, offset: 100 }
          }
        }
      ],
      footnotes: [
        {
          id: 'fn1',
          position: {
            end: { col: 20, line: 1, offset: 34 },
            start: { col: 0, line: 1, offset: 14 }
          }
        },
        {
          id: 'fn2',
          position: {
            end: { col: 20, line: 6, offset: 220 },
            start: { col: 0, line: 6, offset: 200 }
          }
        }
      ]
    });

    const composer = createComposer({
      editor,
      settingsOverrides: { shouldFixFootnotesByDefault: true }
    });

    await composer.splitFile();

    expect(setSelectionsMock).toHaveBeenCalled();
  });

  it('should call removeSelectionRange for footnotes that need restoring', async () => {
    const setSelectionsMock = vi.fn();
    const editor = strictProxy<Editor>({
      getCursor: vi.fn().mockReturnValue({ ch: 0, line: 0 }),
      listSelections: vi
        .fn()
        .mockReturnValue([
          { anchor: { ch: 20, line: 0 }, head: { ch: 50, line: 0 } }
        ]),
      offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
      posToOffset: vi.fn((pos: EditorPosition) => pos.ch),
      replaceSelection: vi.fn(),
      setSelections: setSelectionsMock
    });
    vi.spyOn(app.vault, 'cachedRead')
      .mockResolvedValueOnce('before [^fn1] selected [^fn1]: definition after')
      .mockResolvedValueOnce('target content');
    // One ref is outside the selection (kept) and one is inside (copied) — fn1 lands in both Keep and
    // Copy — and its definition is inside the selection, so fn1 is a "restore" (removeSelectionRange).
    vi.mocked(getCacheSafe).mockResolvedValue({
      footnoteRefs: [
        {
          id: 'fn1',
          position: {
            end: { col: 13, line: 0, offset: 13 },
            start: { col: 7, line: 0, offset: 7 }
          }
        },
        {
          id: 'fn1',
          position: {
            end: { col: 29, line: 0, offset: 29 },
            start: { col: 23, line: 0, offset: 23 }
          }
        }
      ],
      footnotes: [
        {
          id: 'fn1',
          position: {
            end: { col: 45, line: 0, offset: 45 },
            start: { col: 23, line: 0, offset: 23 }
          }
        }
      ]
    });

    const composer = createComposer({
      capturedSelections: [{ endOffset: 50, startOffset: 20 }],
      editor,
      settingsOverrides: { shouldFixFootnotesByDefault: true }
    });

    await composer.splitFile();

    expect(setSelectionsMock).toHaveBeenCalled();
  });
});
