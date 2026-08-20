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
import {
  App,
  getFrontMatterInfo
} from 'obsidian-test-mocks/obsidian';
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

import { relocateAttachments } from '../attachments.ts';
import {
  checkIsCustomAttachmentLocationAvailable,
  collectAttachmentsWithCustomAttachmentLocation
} from '../custom-attachment-location.ts';
import { InsertMode } from '../insert-mode.ts';
import { buildOperationNoticeContent } from '../operation-notices.ts';
import {
  Action,
  FrontmatterMergeStrategy,
  SmartCutAndPasteCompletionFeedback,
  SmartCutAndPasteMoveKind,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { revealInsertedContent } from '../reveal-inserted-content.ts';
import {
  getSelections,
  padEdgeMoveTemplate,
  resolveSmartCutAndPasteTemplate,
  resolveSplitTemplateForNewTargetFile,
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
  readonly shouldJumpToMovedContent?: boolean;
  readonly smartCutAndPasteMoveKind?: SmartCutAndPasteMoveKind;
  readonly targetCursorEndOffset?: number;
  readonly targetCursorOffset?: number;
  readonly templateOverride?: string;
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
  readonly shouldJumpToMovedContent?: boolean;
  readonly smartCutAndPasteMoveKind?: SmartCutAndPasteMoveKind;
  readonly targetCursorEndOffset?: number;
  readonly targetCursorOffset?: number;
  readonly templateOverride?: string;
}

/**
 * One {@link relocateAttachments} move, flattened to paths so a failure names the files rather than dumping
 * two `TFile` objects.
 */
interface RelocationSummary {
  readonly attachment: string;
  readonly newNoteFile: string;
  readonly oldNoteFile: string;
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
    .mockImplementation((callback: (f: DocumentFragment) => Promise<void>) => {
      const fragment = createFragment();
      return callback(fragment).then(() => fragment);
    })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

// Kept REAL, only wrapped, so the notice content still renders exactly as it does in production — the spy is
// Just how the test reaches the `onTargetLinkClick` the composer handed over (issue #232).
vi.mock('../operation-notices.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../operation-notices.ts')>();
  return {
    ...original,
    buildOperationNoticeContent: vi.fn(original.buildOperationNoticeContent)
  };
});

// Only the RENAME is stubbed (it has its own suite in `attachments.test.ts`, against the real vault, and
// The end-to-end move is pinned by `split-attachments.desktop.integration.test.ts`). The COLLECTION stays
// Real, so what these tests assert is the composer's own job: which attachments the extracted range owns
// And which notes they move between (issue #239).
vi.mock('../attachments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../attachments.ts')>()),
  relocateAttachments: vi.fn().mockResolvedValue(undefined)
}));

// The hand-off to Custom Attachment Location reaches a plugin that is not installed in a unit run, and
// It has its own suite. What this one asserts is that the composer asks, with the right note, at the
// Right moment (issue #246).
vi.mock('../custom-attachment-location.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../custom-attachment-location.ts')>()),
  checkIsCustomAttachmentLocationAvailable: vi.fn().mockReturnValue(true),
  collectAttachmentsWithCustomAttachmentLocation: vi.fn()
}));

// `revealInsertedContent` polls a live workspace for a MarkdownView; what this suite asserts is that the
// Composer asks for the right thing, not that the poll works (its locator has its own suite).
vi.mock('../reveal-inserted-content.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reveal-inserted-content.ts')>()),
  revealInsertedContent: vi.fn().mockResolvedValue(undefined)
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
    getValue: vi.fn().mockReturnValue(''),
    listSelections: vi.fn().mockReturnValue(selections),
    offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
    posToOffset: vi.fn((pos: MockPosition) => pos.ch),
    replaceSelection: vi.fn(),
    scrollIntoView: vi.fn(),
    setCursor: vi.fn(),
    setSelection: vi.fn(),
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
      attachmentExtensions: [],
      defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      isPathIgnored: () => false,
      mergeTemplate: '{{content}}',
      reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
      shouldApplyTextAfterExtractionToSameFile: false,
      // The shipped default: the hand-off to Custom Attachment Location is opt-in.
      shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit: false,
      shouldExtractFrontmatterSelectionAsProperties: true,
      shouldFixFootnotesByDefault: false,
      shouldIncludeFrontmatterWhenSplittingByDefault: false,
      shouldMergeHeadingsByDefault: false,
      // The shipped default, so every test in this suite runs the collection the way a user does. The
      // Fixture notes reference nothing, so it collects nothing and no relocation is attempted.
      shouldMoveAttachmentsWhenSplitting: true,
      shouldOpenTargetNoteAfterSplit: false,
      shouldRunTemplaterOnDestinationFile: false,
      shouldShowOperationNotices: true,
      shouldUseSourceTitleWhenTargetHasNoTitle: false,
      smartCutAndPasteCompletionFeedback: SmartCutAndPasteCompletionFeedback.SelectMovedContent,
      smartCutAndPasteTemplate: '',
      smartCutAndPasteToBottomTemplate: '',
      smartCutAndPasteToTopTemplate: '',
      splitTemplate: '',
      splitToExistingFileTemplate: Action.Split,
      textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile,
      ...overrides
    })
  });
}

function getLastNoticeText(pluginNoticeComponent: PluginNoticeComponent): string {
  const [content] = vi.mocked(pluginNoticeComponent.showNotice).mock.lastCall ?? [];
  return castTo<DocumentFragment>(content).textContent;
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
    shouldJumpToMovedContent: options?.shouldJumpToMovedContent,
    smartCutAndPasteMoveKind: options?.smartCutAndPasteMoveKind,
    targetCursorEndOffset: options?.targetCursorEndOffset,
    targetCursorOffset: options?.targetCursorOffset,
    templateOverride: options?.templateOverride
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

  it('should write nothing into the target when the extract is empty, while still leaving the residual (issue #244)', async () => {
    // `Create empty note at cursor...`: the note is created EMPTY and the link is left at the cursor.
    // Running the insert anyway would wrap the template around nothing and leave its separators behind.
    vi.spyOn(app.fileManager, 'generateMarkdownLink').mockReturnValue('[[target]]');
    const editor = createEditorDouble();
    const composer = createComposer({
      capturedSelections: [{ endOffset: 5, startOffset: 5 }],
      editor,
      selectedText: '',
      settingsOverrides: {
        // The shipped default, whose leading separator is exactly what would show up in an "empty" note.
        mergeTemplate: '\n\n{{content}}',
        textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile
      }
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toBe('target body');
    expect(editor.replaceSelection).toHaveBeenCalledWith('[[target]]');
  });

  it('should report an empty extract as a creation rather than as a split (issue #244)', async () => {
    const pluginNoticeComponent = createPluginNoticeComponentStub();
    const composer = createComposer({
      capturedSelections: [{ endOffset: 5, startOffset: 5 }],
      pluginNoticeComponent,
      selectedText: ''
    });

    await composer.splitFile();

    expect(getLastNoticeText(pluginNoticeComponent)).toContain('Created empty note');
  });

  it('should still replace its token when a MOVE has nothing to move (issue #244)', async () => {
    // The `insertToken` half of the empty-extract guard: the token is already in the target, and only the
    // Insert removes it — skipping that would leave the raw token sitting in the note.
    const editor = createEditorDouble();
    const composer = createComposer({
      capturedSelections: [{ endOffset: 5, startOffset: 5 }],
      editor,
      insertToken: 'MOVE-TOKEN',
      selectedText: '',
      targetCursorOffset: 0
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).not.toContain('MOVE-TOKEN');
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

  it('should replace the target selection range with the moved content (paste-over-selection)', async () => {
    const editor = createEditorDouble();
    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor,
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      // 'target body' -> replace [7, 11) ('body') with the token, so the moved content overwrites it.
      targetCursorEndOffset: 11,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).toBe('target MOVED');
    expect(targetContent).not.toContain('body');
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

  it('should report a cross-note split naming both notes, and a same-note extract naming only one (issue #182)', async () => {
    const crossNoteNotice = createPluginNoticeComponentStub();
    await createComposer({ pluginNoticeComponent: crossNoteNotice }).splitFile();

    const sameNoteNotice = createPluginNoticeComponentStub();
    const editor = createEditorDouble();
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        editor,
        file: null,
        setEphemeralState: vi.fn()
      })
    );
    const sourceFile = getSourceFile();
    await new SplitComposer({
      app,
      capturedSelections: [{ endOffset: 11, startOffset: 7 }],
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
      editor,
      isMultipleSplit: false,
      isNewTargetFile: false,
      pluginNoticeComponent: sameNoteNotice,
      pluginSettingsComponent: createPluginSettingsComponentStub({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      }),
      resourceLockComponent,
      selectedText: 'MOVED',
      sourceFile,
      targetCursorOffset: 0,
      targetFile: sourceFile
    }).splitFile();

    // The link text itself is stubbed away here; what matters is the prose the two cases pick.
    expect(getLastNoticeText(crossNoteNotice)).toContain('Split note');
    expect(getLastNoticeText(crossNoteNotice)).toContain(' into ');
    // Naming both sides of a same-note extract would read `Split note A into A`.
    expect(getLastNoticeText(sameNoteNotice)).toContain('Moved the extracted content within note');
    expect(getLastNoticeText(sameNoteNotice)).not.toContain(' into ');
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

  it('selects the moved content in the target after a smart cut & paste move (issue #144)', async () => {
    const targetEditor = createEditorDouble();
    // The freshly opened target shows the moved text; the cursor selects exactly it (offset 7..12 in
    // 'target MOVED'). The selection is computed from the (whitespace-trimmed) content string that
    // Replaced the insert token, located in the live editor value.
    vi.mocked(targetEditor.getValue).mockReturnValue('target MOVED');
    const setEphemeralStateMock = vi.fn();
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        // A real `file` is what makes the view resolve as the TARGET note; the resource lock's
        // Status-bar reconcile then reads `containerEl.ownerDocument` (there is no status bar in
        // Jsdom, so it early-returns).
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: setEphemeralStateMock
      })
    );

    const showNoticeMock = vi.fn();
    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({
        showNotice: showNoticeMock,
        showNoticeAfterDelay: vi.fn().mockReturnValue({ setContent: vi.fn(), [Symbol.dispose]: vi.fn() })
      }),
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(targetEditor.setSelection).toHaveBeenCalledWith({ ch: 7, line: 0 }, { ch: 12, line: 0 });
    expect(targetEditor.scrollIntoView).toHaveBeenCalledWith({ from: { ch: 7, line: 0 }, to: { ch: 12, line: 0 } }, true);
    // The default feedback mode selects and says nothing more — no completion notice.
    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  it('selects the moved content itself, not an earlier identical occurrence (issue #175)', async () => {
    // The reporter moved the word `test` to the BOTTOM of a note that already said 'This is a test'
    // Earlier, so a first-occurrence search landed the cursor on THAT copy instead of on the moved
    // Text — which is why the same move to the TOP looked fine (there the moved copy IS the first
    // Occurrence). Here the target already opens with 'MOVED' and 'MOVED' is moved to the very end, so
    // The moved copy is the SECOND occurrence, at offset 10.
    await app.vault.modify(getTargetFile(), 'MOVED here');
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('MOVED hereMOVED');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: vi.fn()
      })
    );

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 10
    });

    await composer.splitFile();

    expect(targetEditor.setSelection).toHaveBeenCalledWith({ ch: 10, line: 0 }, { ch: 15, line: 0 });
  });

  it('falls back to searching for the moved content when the pinned offset no longer matches', async () => {
    // A write that lands after the move (the frontmatter merge) can shift the body out from under the
    // Recorded offset, so the search fallback still has to find it.
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('PREFIX target MOVED');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: vi.fn()
      })
    );

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    // Pinned at 7, but the shifted body puts it at 14.
    expect(targetEditor.setSelection).toHaveBeenCalledWith({ ch: 14, line: 0 }, { ch: 19, line: 0 });
  });

  it('falls back to the trimmed moved text when the template whitespace did not survive', async () => {
    // The reporter's own template shape: `{{content}}\n`. If the trailing newline is normalized away in
    // The target, the exact templated string is gone but the text itself is still there.
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('PREFIX target MOVED');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: vi.fn()
      })
    );

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        mergeTemplate: '{{content}}\n',
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(targetEditor.setSelection).toHaveBeenCalledWith({ ch: 14, line: 0 }, { ch: 19, line: 0 });
  });

  it('gives up rather than jumping to the top when whitespace-only moved content cannot be located', async () => {
    // `indexOf('')` answers 0, which would send the cursor to the top of the note — a wrong jump is
    // Worse than no jump.
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('no-whitespace-here');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: vi.fn()
      })
    );
    const consoleDebugMock = vi.fn();

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: consoleDebugMock }),
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: ' ',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(targetEditor.setSelection).not.toHaveBeenCalled();
    expect(targetEditor.setCursor).not.toHaveBeenCalled();
    expect(consoleDebugMock).toHaveBeenCalledWith(expect.stringContaining('Could not locate the inserted content'));
  });

  it('places a collapsed cursor and shows a notice instead of selecting, in Notice feedback mode (issue #176)', async () => {
    // A selection in the target is indistinguishable from the highlight on a still-marked selection,
    // So this mode moves the cursor onto the moved text without selecting it and says so in a notice.
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('target MOVED');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: vi.fn()
      })
    );
    const showNoticeMock = vi.fn();

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({
        showNotice: showNoticeMock,
        showNoticeAfterDelay: vi.fn().mockReturnValue({ setContent: vi.fn(), [Symbol.dispose]: vi.fn() })
      }),
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        smartCutAndPasteCompletionFeedback: SmartCutAndPasteCompletionFeedback.Notice,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(targetEditor.setCursor).toHaveBeenCalledWith({ ch: 7, line: 0 });
    expect(targetEditor.setSelection).not.toHaveBeenCalled();
    expect(targetEditor.scrollIntoView).toHaveBeenCalledWith({ from: { ch: 7, line: 0 }, to: { ch: 12, line: 0 } }, true);
    expect(showNoticeMock).toHaveBeenCalled();
  });

  it('both selects and notifies in SelectMovedContentAndNotice feedback mode (issue #176)', async () => {
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('target MOVED');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: vi.fn()
      })
    );
    const showNoticeMock = vi.fn();

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({
        showNotice: showNoticeMock,
        showNoticeAfterDelay: vi.fn().mockReturnValue({ setContent: vi.fn(), [Symbol.dispose]: vi.fn() })
      }),
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        smartCutAndPasteCompletionFeedback: SmartCutAndPasteCompletionFeedback.SelectMovedContentAndNotice,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(targetEditor.setSelection).toHaveBeenCalledWith({ ch: 7, line: 0 }, { ch: 12, line: 0 });
    expect(targetEditor.setCursor).not.toHaveBeenCalled();
    expect(showNoticeMock).toHaveBeenCalled();
  });

  it('inserts a `$&` in the moved text literally instead of expanding it as a replacement pattern', async () => {
    // The token is swapped for the moved content via `String.replace`, whose string replacement treats
    // `$&`/`$'`/`` $` `` as back-references — so moving text containing them used to write the matched
    // Token back instead of the text.
    const composer = createComposer({
      capturedSelections: [{ endOffset: 2, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: '$&',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toBe('target $&body');
  });

  it('does not select the moved content when shouldJumpToMovedContent is off (issue #144 follow-up)', async () => {
    // Identical to the test above except for the flag, so it isolates the gate: the move still runs
    // (the target ends up holding the moved text), but the cursor is left where it was.
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('target MOVED');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        editor: targetEditor,
        file: null,
        setEphemeralState: vi.fn()
      })
    );

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      shouldJumpToMovedContent: false,
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(targetEditor.setSelection).not.toHaveBeenCalled();
    expect(targetEditor.scrollIntoView).not.toHaveBeenCalled();
    const content = await app.vault.adapter.read('target.md');
    expect(content).toContain('MOVED');
  });

  it('does not select in the target when there is no active markdown view', async () => {
    const editor = createEditorDouble();
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(null);

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      editor,
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(editor.setSelection).not.toHaveBeenCalled();
  });

  it('gives up with a debug log when the moved content never shows up in the target', async () => {
    // The give-up path must be observable: a silent return here is exactly what a user reports as
    // "the cursor did not jump", with nothing in the console to explain it (issue #175).
    const targetEditor = createEditorDouble();
    vi.mocked(targetEditor.getValue).mockReturnValue('unrelated content');
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({
        containerEl: createDiv(),
        editor: targetEditor,
        file: getTargetFile(),
        setEphemeralState: vi.fn()
      })
    );
    const consoleDebugMock = vi.fn();

    const composer = createComposer({
      capturedSelections: [{ endOffset: 11, startOffset: 0 }],
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: consoleDebugMock }),
      editor: createEditorDouble(),
      insertToken: 'TK',
      isNewTargetFile: false,
      selectedText: 'MOVED',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        textAfterExtractionMode: TextAfterExtractionMode.None
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      targetCursorOffset: 7
    });

    await composer.splitFile();

    expect(targetEditor.setSelection).not.toHaveBeenCalled();
    expect(consoleDebugMock).toHaveBeenCalledWith(expect.stringContaining('Could not locate the inserted content'));
  });
});

describe('splitFile attachments (issue #239)', () => {
  // `![[img.png]]` is 12 characters, so [0, 12) is the extracted range and `tail` is what stays behind.
  const EMBED_END_OFFSET = 12;

  beforeEach(async () => {
    vi.mocked(relocateAttachments).mockClear();
    await app.vault.create('img.png', 'PIC');
    await app.vault.modify(getSourceFile(), '![[img.png]] tail');
  });

  function getLastRelocations(): RelocationSummary[] {
    const [params] = vi.mocked(relocateAttachments).mock.lastCall ?? [];
    return (params?.relocations ?? []).map((relocation) => ({
      attachment: relocation.attachment.path,
      newNoteFile: relocation.newNoteFile.path,
      oldNoteFile: relocation.oldNoteFile.path
    }));
  }

  it('should carry an attachment the extracted range references into the target note', async () => {
    await createComposer({
      capturedSelections: [{ endOffset: EMBED_END_OFFSET, startOffset: 0 }],
      selectedText: '![[img.png]]'
    }).splitFile();

    expect(getLastRelocations()).toEqual([{
      attachment: 'img.png',
      newNoteFile: 'target.md',
      oldNoteFile: 'source.md'
    }]);
  });

  it('should leave an attachment the text left behind still references', async () => {
    await app.vault.modify(getSourceFile(), '![[img.png]] ![[img.png]]');

    await createComposer({
      capturedSelections: [{ endOffset: EMBED_END_OFFSET, startOffset: 0 }],
      selectedText: '![[img.png]]'
    }).splitFile();

    expect(relocateAttachments).not.toHaveBeenCalled();
  });

  it('should relocate nothing when the setting is off', async () => {
    await createComposer({
      capturedSelections: [{ endOffset: EMBED_END_OFFSET, startOffset: 0 }],
      selectedText: '![[img.png]]',
      settingsOverrides: { shouldMoveAttachmentsWhenSplitting: false }
    }).splitFile();

    expect(relocateAttachments).not.toHaveBeenCalled();
  });

  describe('collecting with Custom Attachment Location (issue #246)', () => {
    beforeEach(() => {
      // Calls and the stubbed availability both leak between tests otherwise, so
      // `not.toHaveBeenCalled()` would see the previous test's call.
      vi.mocked(collectAttachmentsWithCustomAttachmentLocation).mockClear();
      vi.mocked(checkIsCustomAttachmentLocationAvailable).mockClear().mockReturnValue(true);
    });

    it('should hand the target note over once the extract lands', async () => {
      await createComposer({
        capturedSelections: [{ endOffset: EMBED_END_OFFSET, startOffset: 0 }],
        selectedText: '![[img.png]]',
        settingsOverrides: { shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit: true }
      }).splitFile();

      expect(collectAttachmentsWithCustomAttachmentLocation).toHaveBeenCalledWith({
        abstractFiles: [getTargetFile()],
        app
      });
    });

    it('should hand nothing over when the setting is off', async () => {
      await createComposer({
        capturedSelections: [{ endOffset: EMBED_END_OFFSET, startOffset: 0 }],
        selectedText: '![[img.png]]'
      }).splitFile();

      expect(collectAttachmentsWithCustomAttachmentLocation).not.toHaveBeenCalled();
    });

    it('should note in the debug log when the other plugin is unavailable', async () => {
      vi.mocked(checkIsCustomAttachmentLocationAvailable).mockReturnValue(false);
      const consoleDebug = vi.fn();

      await createComposer({
        capturedSelections: [{ endOffset: EMBED_END_OFFSET, startOffset: 0 }],
        consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug }),
        selectedText: '![[img.png]]',
        settingsOverrides: { shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit: true }
      }).splitFile();

      expect(consoleDebug).toHaveBeenCalledWith(expect.stringContaining('Custom Attachment Location plugin is not available'));
    });
  });

  it('should relocate nothing for a same-note extract', async () => {
    // Source and target share one attachment folder, so there is nowhere for the attachment to go.
    const editor = createEditorDouble();
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
      strictProxy<MarkdownView>({ editor, file: null, setEphemeralState: vi.fn() })
    );
    const sourceFile = getSourceFile();

    await new SplitComposer({
      app,
      capturedSelections: [{ endOffset: EMBED_END_OFFSET, startOffset: 0 }],
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
      editor,
      insertMode: InsertMode.Append,
      isMultipleSplit: false,
      isNewTargetFile: false,
      pluginNoticeComponent: createPluginNoticeComponentStub(),
      pluginSettingsComponent: createPluginSettingsComponentStub(),
      resourceLockComponent,
      selectedText: '![[img.png]]',
      sourceFile,
      targetFile: sourceFile
    }).splitFile();

    expect(relocateAttachments).not.toHaveBeenCalled();
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

  it('should use the smart cut & paste template for a smart-cut move when it is set', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: 'smart: {{content}}',
        splitTemplate: 'split: {{content}}'
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain('smart:');
  });

  it('should prefer the to-top override for a move to the top of the file (issue #174)', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: 'smart: {{content}}',
        smartCutAndPasteToBottomTemplate: 'bottom: {{content}}',
        smartCutAndPasteToTopTemplate: 'top: {{content}}',
        splitTemplate: 'split: {{content}}'
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.ToTop
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).toContain('top:');
    expect(targetContent).not.toContain('smart:');
  });

  it('should prefer the to-bottom override for a move to the bottom of the file (issue #174)', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: 'smart: {{content}}',
        smartCutAndPasteToBottomTemplate: 'bottom: {{content}}',
        smartCutAndPasteToTopTemplate: 'top: {{content}}',
        splitTemplate: 'split: {{content}}'
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.ToBottom
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).toContain('bottom:');
    expect(targetContent).not.toContain('smart:');
  });

  it('should fall back to the shared smart cut & paste template when the direction override is empty (issue #174)', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: 'smart: {{content}}',
        smartCutAndPasteToBottomTemplate: 'bottom: {{content}}',
        smartCutAndPasteToTopTemplate: '',
        splitTemplate: 'split: {{content}}'
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.ToTop
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).toContain('smart:');
    expect(targetContent).not.toContain('bottom:');
  });

  it('should use the shared smart cut & paste template for a move at the cursor even when both overrides are set (issue #174)', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: 'smart: {{content}}',
        smartCutAndPasteToBottomTemplate: 'bottom: {{content}}',
        smartCutAndPasteToTopTemplate: 'top: {{content}}',
        splitTemplate: 'split: {{content}}'
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).toContain('smart:');
    expect(targetContent).not.toContain('top:');
    expect(targetContent).not.toContain('bottom:');
  });

  it('should fall back to the split template for a smart-cut move when the smart cut & paste template is empty', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: '',
        splitTemplate: 'split: {{content}}',
        splitToExistingFileTemplate: Action.Split
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain('split:');
  });

  it('should fall through to the split chain for an edge move when every smart cut & paste template is empty (issue #174)', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: '',
        smartCutAndPasteToBottomTemplate: '',
        smartCutAndPasteToTopTemplate: '',
        splitTemplate: 'split: {{content}}',
        splitToExistingFileTemplate: Action.Split
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.ToBottom
    });

    await composer.splitFile();

    expect(await app.vault.adapter.read('target.md')).toContain('split:');
  });

  it('should not use the smart cut & paste template for an ordinary split when the move flag is off', async () => {
    const composer = createComposer({
      isNewTargetFile: false,
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: 'smart: {{content}}',
        splitTemplate: 'split: {{content}}',
        splitToExistingFileTemplate: Action.Split
      }
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).toContain('split:');
    expect(targetContent).not.toContain('smart:');
  });

  it('should prefer an explicit template override over every setting (issue #172)', async () => {
    const composer = createComposer({
      settingsOverrides: {
        mergeTemplate: 'merge: {{content}}',
        smartCutAndPasteTemplate: 'smart: {{content}}',
        splitTemplate: 'split: {{content}}'
      },
      smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind.AtCursor,
      // The recursive split hands over the identity template so nothing is added until its deferred
      // Template pass runs.
      templateOverride: '{{content}}'
    });

    await composer.splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    expect(targetContent).not.toContain('merge:');
    expect(targetContent).not.toContain('smart:');
    expect(targetContent).not.toContain('split:');
  });
});

describe('padEdgeMoveTemplate', () => {
  // Issue #179. The shipped default is `mergeTemplate: '\n\n{{content}}'` — a LEADING separator only —
  // So a top move glued the block onto the note's existing first line. The reporter's own
  // `'{{content}}\n'` is the mirror image and merged at the bottom instead. Both must be padded, or the
  // Half that is not padded stays broken.
  it('should add the missing trailing break to the shipped default, which merged at the top', () => {
    expect(padEdgeMoveTemplate('\n\n{{content}}', SmartCutAndPasteMoveKind.ToTop)).toBe('\n\n{{content}}\n');
  });

  it('should add the missing leading break to the reporter\'s template, which merged at the bottom', () => {
    expect(padEdgeMoveTemplate('{{content}}\n', SmartCutAndPasteMoveKind.ToBottom)).toBe('\n{{content}}\n');
  });

  it('should pad both ends of a template that has neither', () => {
    expect(padEdgeMoveTemplate('{{content}}', SmartCutAndPasteMoveKind.ToTop)).toBe('\n{{content}}\n');
  });

  it('should leave a template that already has both ends untouched', () => {
    expect(padEdgeMoveTemplate('\n\n{{content}}\n\n', SmartCutAndPasteMoveKind.ToBottom)).toBe('\n\n{{content}}\n\n');
  });

  // An at-cursor paste is inserted at a token the user placed mid-line. Forcing a break onto either end
  // Would break the case that move exists for, so it is deliberately out of scope.
  it('should leave an at-cursor move without padding', () => {
    expect(padEdgeMoveTemplate('{{content}}', SmartCutAndPasteMoveKind.AtCursor)).toBe('{{content}}');
  });

  it('should leave a flow that is not a smart cut & paste move without padding', () => {
    expect(padEdgeMoveTemplate('{{content}}', undefined)).toBe('{{content}}');
  });
});

describe('resolveSmartCutAndPasteTemplate', () => {
  const SETTINGS = {
    smartCutAndPasteTemplate: 'smart: {{content}}',
    smartCutAndPasteToBottomTemplate: 'bottom: {{content}}',
    smartCutAndPasteToTopTemplate: 'top: {{content}}'
  };

  it('should return the to-top override for a move to the top of the file', () => {
    expect(resolveSmartCutAndPasteTemplate(SETTINGS, SmartCutAndPasteMoveKind.ToTop)).toBe('top: {{content}}');
  });

  it('should return the to-bottom override for a move to the bottom of the file', () => {
    expect(resolveSmartCutAndPasteTemplate(SETTINGS, SmartCutAndPasteMoveKind.ToBottom)).toBe('bottom: {{content}}');
  });

  it('should return the shared template for a move at the cursor, which has no override of its own', () => {
    expect(resolveSmartCutAndPasteTemplate(SETTINGS, SmartCutAndPasteMoveKind.AtCursor)).toBe('smart: {{content}}');
  });

  it('should fall back to the shared template when the direction override is empty', () => {
    expect(resolveSmartCutAndPasteTemplate({ ...SETTINGS, smartCutAndPasteToTopTemplate: '' }, SmartCutAndPasteMoveKind.ToTop)).toBe('smart: {{content}}');
  });

  it('should return an empty string when nothing is configured, so the split chain takes over', () => {
    const emptySettings = {
      smartCutAndPasteTemplate: '',
      smartCutAndPasteToBottomTemplate: '',
      smartCutAndPasteToTopTemplate: ''
    };
    expect(resolveSmartCutAndPasteTemplate(emptySettings, SmartCutAndPasteMoveKind.ToBottom)).toBe('');
  });
});

describe('resolveSplitTemplateForNewTargetFile', () => {
  it('should return the split template when it is set', () => {
    expect(resolveSplitTemplateForNewTargetFile({ mergeTemplate: 'merge: {{content}}', splitTemplate: 'split: {{content}}' })).toBe('split: {{content}}');
  });

  it('should fall back to the merge template when the split template is empty', () => {
    expect(resolveSplitTemplateForNewTargetFile({ mergeTemplate: 'merge: {{content}}', splitTemplate: '' })).toBe('merge: {{content}}');
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
      features: [],
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
      features: [],
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

describe('splitFile frontmatter-only extract', () => {
  const SOURCE_WITH_FRONTMATTER = '---\naliases:\n  - alpha\n  - bravo\n---\n\nsource body\n';

  function createFrontmatterSourceComposer(options?: CreateComposerOptions): SplitComposer {
    return createComposer({
      capturedSelections: [{
        endOffset: SOURCE_WITH_FRONTMATTER.indexOf('alpha') + 'alpha'.length,
        startOffset: SOURCE_WITH_FRONTMATTER.indexOf('alpha')
      }],
      isNewTargetFile: false,
      selectedText: '  - alpha',
      ...options
    });
  }

  beforeEach(async () => {
    await app.vault.modify(getSourceFile(), SOURCE_WITH_FRONTMATTER);
  });

  it('should merge the selected properties into the target frontmatter instead of its body', async () => {
    const editor = createEditorDouble();
    await createFrontmatterSourceComposer({ editor }).splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    const targetBody = targetContent.slice(getFrontMatterInfo(targetContent).contentStart);
    expect(targetContent).toContain('alpha');
    expect(targetBody).not.toContain('alpha');
    expect(targetBody).toContain('target body');
  });

  it('should offer the notice link no jump, having written no body to jump to (issue #232)', async () => {
    await createFrontmatterSourceComposer({ editor: createEditorDouble() }).splitFile();

    // The properties were merged into the destination's own frontmatter, so there is no inserted region;
    // The link keeps its plain open-the-note behavior rather than jumping somewhere arbitrary.
    expect(getTargetLinkClickAction()).toBeUndefined();
  });

  it('should rewrite the source frontmatter with what is left', async () => {
    const editor = createEditorDouble();
    await createFrontmatterSourceComposer({ editor }).splitFile();

    // The whole YAML region is replaced, so the key line survives with only the value that stayed.
    expect(editor.replaceSelection).toHaveBeenCalledWith('aliases:\n  - bravo');
  });

  it('should extract the raw text when the setting is off', async () => {
    const editor = createEditorDouble();
    await createFrontmatterSourceComposer({
      editor,
      settingsOverrides: {
        shouldExtractFrontmatterSelectionAsProperties: false,
        textAfterExtractionMode: TextAfterExtractionMode.None
      }
    }).splitFile();

    const targetContent = await app.vault.adapter.read('target.md');
    const targetBody = targetContent.slice(getFrontMatterInfo(targetContent).contentStart);
    // The raw YAML lines land in the BODY, and the source keeps the ordinary `Text after extraction`
    // Residual instead of a rewritten frontmatter block.
    expect(targetBody).toContain('  - alpha');
    expect(editor.replaceSelection).toHaveBeenCalledWith('');
  });

  it('should refuse to extract properties into the same note', async () => {
    const editor = createEditorDouble();
    const pluginNoticeComponent = createPluginNoticeComponentStub();
    const sourceFile = getSourceFile();
    const composer = new SplitComposer({
      app,
      capturedSelections: [{
        endOffset: SOURCE_WITH_FRONTMATTER.indexOf('alpha') + 'alpha'.length,
        startOffset: SOURCE_WITH_FRONTMATTER.indexOf('alpha')
      }],
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
      editor,
      isMultipleSplit: false,
      isNewTargetFile: false,
      pluginNoticeComponent,
      pluginSettingsComponent: createPluginSettingsComponentStub(),
      resourceLockComponent,
      selectedText: '  - alpha',
      sourceFile,
      targetFile: sourceFile
    });

    await composer.splitFile();

    expect(vi.mocked(pluginNoticeComponent.showNotice)).toHaveBeenCalledWith('Cannot extract a note\'s properties into that same note.');
    expect(await app.vault.adapter.read('source.md')).toBe(SOURCE_WITH_FRONTMATTER);
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });
});

/*
 * Issue #232: the destination link of an extract's completion notice used to open the note at its top,
 * leaving the reporter to hunt for what they had just extracted. It now carries an action that lands them on
 * it — reusing the very pair the smart cut & paste jump of issues #144/#175 already records.
 */
describe('splitFile completion notice link', () => {
  it('should hand the notice an action that jumps to the extracted content', async () => {
    const composer = createComposer({
      capturedSelections: [{ endOffset: 16, startOffset: 0 }],
      editor: createEditorDouble(),
      isNewTargetFile: false,
      selectedText: 'EXTRACTED-CONTENT',
      settingsOverrides: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        mergeTemplate: '{{content}}',
        textAfterExtractionMode: TextAfterExtractionMode.None
      }
    });

    await composer.splitFile();
    await ensureNonNullable(getTargetLinkClickAction())();

    // Read off the recorded call rather than matched with `objectContaining`: pretty-format probes every
    // Property of a mismatch, and a `strictProxy` TFile throws on the first unmocked one.
    const revealParams = ensureNonNullable(vi.mocked(revealInsertedContent).mock.lastCall)[0];
    // The DESTINATION note, and the exact string that was written into it — not a heading anchor, which
    // Only `Extract this heading...` could ever have supplied.
    expect(vi.mocked(revealInsertedContent)).toHaveBeenCalledOnce();
    expect(revealParams.file).toBe(getTargetFile());
    expect(revealParams.insertedContent).toBe('EXTRACTED-CONTENT');
    expect(revealParams.insertedContentOffset).toBe('target body'.length);
  });
});

/**
 * Reads back the action the composer handed to its COMPLETION notice for the destination link.
 *
 * The progress notice builds its content through the same function, so the call is picked by
 * `isLoading` rather than by position — a delayed progress notice that did resolve its content would
 * otherwise be mistaken for the completion one.
 *
 * @returns The action, or `undefined` when none was offered.
 */
function getTargetLinkClickAction(): (() => Promise<void>) | undefined {
  const calls = [...vi.mocked(buildOperationNoticeContent).mock.calls].reverse();
  const completionCall = calls.find(([callParams]) => !(callParams.isLoading ?? false));
  return ensureNonNullable(completionCall)[0].onTargetLinkClick;
}
