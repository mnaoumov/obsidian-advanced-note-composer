import type {
  App,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
  MarkdownView,
  MetadataCache,
  TFile,
  Vault
} from 'obsidian';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { RunLockedTransactionParams } from '../locked-transaction.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { runLockedTransaction } from '../locked-transaction.ts';
import { CommandMenuPlacement } from '../plugin-settings.ts';
import { updateHeadingBacklinks } from '../rename-heading.ts';
import { RenameHeadingEditorCommandHandler } from './rename-heading-editor-command-handler.ts';

interface CreateParamsOptions {
  readonly cacheIsNull?: boolean;
  readonly content?: string;
  readonly cursorLine?: number;
  readonly headings?: readonly HeadingCache[];
  readonly isPathIgnored?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
  readonly shouldShowOperationNotices?: boolean;
}

interface HandlerParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(): boolean;
  shouldAddToViewportMenu(view: MarkdownView, mode: string, source: string): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/modals/prompt', () => ({
  prompt: vi.fn()
}));

vi.mock('../locked-transaction.ts', () => ({
  runLockedTransaction: vi.fn()
}));

vi.mock('../rename-heading.ts', () => ({
  updateHeadingBacklinks: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockPrompt = vi.mocked(prompt);
const mockRunLockedTransaction = vi.mocked(runLockedTransaction);
const mockUpdateHeadingBacklinks = vi.mocked(updateHeadingBacklinks);
const mockModify = vi.fn().mockResolvedValue(undefined);

const FILE = castTo<TFile>({ path: 'note.md' });
const HEADING_CONTENT = '## Old Heading\nbody\n';

function heading(level: number, text: string, line: number, startOffset: number, endOffset: number): HeadingCache {
  return castTo<HeadingCache>({ heading: text, level, position: { end: { offset: endOffset }, start: { line, offset: startOffset } } });
}

const DEFAULT_HEADINGS: HeadingCache[] = [heading(2, 'Old Heading', 0, 0, 14)];

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(cursorLine = 0): Editor {
  return strictProxy<Editor>({ getCursor: vi.fn().mockReturnValue({ ch: 0, line: cursorLine }) });
}

function createMockParams(options: CreateParamsOptions = {}): HandlerParams {
  return {
    app: strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn().mockReturnValue(options.cacheIsNull ? null : { headings: options.headings ?? DEFAULT_HEADINGS })
      }),
      vault: strictProxy<Vault>({
        read: vi.fn().mockResolvedValue(options.content ?? HEADING_CONTENT)
      })
    }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }), showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
        isPathIgnored: vi.fn().mockReturnValue(options.isPathIgnored ?? false),
        shouldAddCommandsToSubmenu: true,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(options.shouldBlockCommandOnPath ?? false),
        shouldBlockVaultDuringOperations: false,
        shouldShowOperationNotices: options.shouldShowOperationNotices ?? true
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function getShownNoticeText(pluginNoticeComponent: PluginNoticeComponent): string {
  const [content] = vi.mocked(pluginNoticeComponent.showNotice).mock.lastCall ?? [];
  return castTo<DocumentFragment>(content).textContent;
}

function toTestable(handler: RenameHeadingEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

/**
 * Lets the mocked `createFragmentAsync` build a real fragment, so a notice's rendered text can be
 * asserted instead of just the fact that one was shown.
 */
function useRealFragments(): void {
  mockCreateFragmentAsync.mockImplementation(async (callback) => {
    const fragment = createFragment();
    await (callback as (f: DocumentFragment) => Promise<void>)(fragment);
    return fragment;
  });
  mockRenderInternalLink.mockImplementation((linkParams) => {
    const path = typeof linkParams.pathOrAbstractFile === 'string' ? linkParams.pathOrAbstractFile : linkParams.pathOrAbstractFile.path;
    return Promise.resolve(createEl('a', { text: `[${path}]` }));
  });
}

describe('RenameHeadingEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealFragments();
    mockRunLockedTransaction.mockImplementation(async (params: RunLockedTransactionParams) => {
      await params.body(strictProxy<VaultTransaction>({ modify: mockModify }));
    });
    mockUpdateHeadingBacklinks.mockResolvedValue(0);
  });

  it('should construct with correct params', () => {
    const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('rename-heading');
    expect(handler.name).toBe('Rename heading...');
    expect(handler.icon).toBe('lucide-edit-3');
  });

  describe('canExecuteEditor', () => {
    it('should be unavailable when the command is blocked on the path', () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams({ shouldBlockCommandOnPath: true })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(FILE))).toBe(false);
    });

    it('should be unavailable when context.file is null', () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(null))).toBe(false);
    });

    it('should be unavailable when the cursor is not on a heading line', () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      expect(handler.canExecuteEditor(createMockEditor(5), createMockContext(FILE))).toBe(false);
    });

    it('should be unavailable when the file has no metadata cache', () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams({ cacheIsNull: true })));
      expect(handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE))).toBe(false);
    });

    it('should be available when the cursor is on a heading line', () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      expect(handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE))).toBe(true);
    });
  });

  describe('executeEditor', () => {
    it('should return early when context.file is null', async () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      await handler.executeEditor(createMockEditor(), createMockContext(null));
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should notice when the path is ignored', async () => {
      const params = createMockParams({ isPathIgnored: true });
      const handler = toTestable(new RenameHeadingEditorCommandHandler(params));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));

      const mockFragment = strictProxy<DocumentFragment>({ append: vi.fn(), appendChild: vi.fn(), appendText: vi.fn() });
      mockCreateFragmentAsync.mockImplementation(async (callback) => {
        await (callback as (f: DocumentFragment) => Promise<void>)(mockFragment);
        return mockFragment;
      });
      mockRenderInternalLink.mockResolvedValue(createEl('a'));

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should return when no heading was resolved', async () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      // ExecuteEditor without a prior canExecuteEditor leaves the resolved heading unset.
      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should do nothing when the prompt is cancelled', async () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue(null);

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should do nothing when the new heading is empty', async () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue('');

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should do nothing when the heading is unchanged', async () => {
      const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue('Old Heading');

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should rewrite the heading line and update backlinks', async () => {
      const params = createMockParams();
      const handler = toTestable(new RenameHeadingEditorCommandHandler(params));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue('New Heading');
      mockUpdateHeadingBacklinks.mockResolvedValue(2);
      useRealFragments();

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));

      expect(mockRunLockedTransaction).toHaveBeenCalledOnce();
      expect(mockModify).toHaveBeenCalledWith(FILE, '## New Heading\nbody\n');
      expect(mockUpdateHeadingBacklinks).toHaveBeenCalledWith(expect.objectContaining({
        newHeading: 'New Heading',
        notePathOrFile: FILE,
        oldHeading: 'Old Heading'
      }));
      expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Renamed heading "Old Heading" to "New Heading" in note [note.md] and updated 2 link(s).');
    });

    it('should report the rename without a link count when no links were updated', async () => {
      const params = createMockParams();
      const handler = toTestable(new RenameHeadingEditorCommandHandler(params));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue('New Heading');
      mockUpdateHeadingBacklinks.mockResolvedValue(0);
      useRealFragments();

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));

      expect(mockModify).toHaveBeenCalledWith(FILE, '## New Heading\nbody\n');
      expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Renamed heading "Old Heading" to "New Heading" in note [note.md].');
    });

    it('should report nothing when the operation is cancelled', async () => {
      const params = createMockParams();
      const handler = toTestable(new RenameHeadingEditorCommandHandler(params));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue('New Heading');
      mockRunLockedTransaction.mockImplementation((transactionParams: RunLockedTransactionParams) => {
        transactionParams.abortController.abort();
        return Promise.reject(new Error('cancelled'));
      });

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));

      expect(params.pluginNoticeComponent.showNotice).not.toHaveBeenCalled();
    });

    it('should rethrow a failure that is not a cancellation', async () => {
      const params = createMockParams();
      const handler = toTestable(new RenameHeadingEditorCommandHandler(params));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue('New Heading');
      mockRunLockedTransaction.mockRejectedValue(new Error('disk on fire'));

      await expect(handler.executeEditor(createMockEditor(0), createMockContext(FILE))).rejects.toThrow('disk on fire');
      expect(params.pluginNoticeComponent.showNotice).not.toHaveBeenCalled();
    });

    it('should show no notice when operation notices are turned off', async () => {
      const params = createMockParams({ shouldShowOperationNotices: false });
      const handler = toTestable(new RenameHeadingEditorCommandHandler(params));
      handler.canExecuteEditor(createMockEditor(0), createMockContext(FILE));
      mockPrompt.mockResolvedValue('New Heading');
      mockUpdateHeadingBacklinks.mockResolvedValue(2);
      useRealFragments();

      await handler.executeEditor(createMockEditor(0), createMockContext(FILE));

      expect(mockModify).toHaveBeenCalledWith(FILE, '## New Heading\nbody\n');
      expect(params.pluginNoticeComponent.showNotice).not.toHaveBeenCalled();
    });
  });

  it('should add to the editor menu and reflect the submenu setting', () => {
    const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });
});

/**
 * Builds a `showNoticeAfterDelay` stub that invokes the lazy content builder, so the progress-notice
 * content is exercised — the real component only runs it once the delay elapses. Fire-and-forget: its
 * result is not under test.
 *
 * @returns The stub.
 */
function createShowNoticeAfterDelayStub(): PluginNoticeComponent['showNoticeAfterDelay'] {
  return vi.fn().mockImplementation((delayedNoticeParams: PluginNoticeComponentShowNoticeAfterDelayParams) => {
    invokeAsyncSafely(async () => {
      await castTo<() => Promise<unknown>>(delayedNoticeParams.content)();
    });
    return { setContent: vi.fn(), [Symbol.dispose]: vi.fn() };
  });
}

/**
 * The `mode` and `source` Obsidian passes with `markdown-viewport-menu` for a right-click on the empty
 * margin beside the text, or on the line-number gutter, of a note being edited (issue #252).
 */
const VIEWPORT_MENU_MODE = 'source';
const VIEWPORT_MENU_SOURCE = 'gutter';

function createMockMarkdownView(editor: Editor): MarkdownView {
  return strictProxy<MarkdownView>({ editor });
}

describe('RenameHeadingEditorCommandHandler viewport menu placement', () => {
  it('should stay off the readable-line-length margin while the category is placed in the editor menu', () => {
    const handler = toTestable(new RenameHeadingEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToViewportMenu(createMockMarkdownView(createMockEditor()), VIEWPORT_MENU_MODE, VIEWPORT_MENU_SOURCE)).toBe(false);
  });

  it('should appear on the readable-line-length margin once the category is placed there (issue #252)', () => {
    const params = createMockParams();
    vi.mocked(params.pluginSettingsComponent.settings.commandMenuPlacement).mockReturnValue(CommandMenuPlacement.ViewportMenu);
    const handler = toTestable(new RenameHeadingEditorCommandHandler(params));
    expect(handler.shouldAddToViewportMenu(createMockMarkdownView(createMockEditor()), VIEWPORT_MENU_MODE, VIEWPORT_MENU_SOURCE)).toBe(true);
  });
});
