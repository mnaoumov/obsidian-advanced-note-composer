import type {
  App,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
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
import { openReorderHeadingsModal } from '../modals/reorder-headings-modal.ts';
import { ReorderHeadingsEditorCommandHandler } from './reorder-headings-editor-command-handler.ts';

interface CreateParamsOptions {
  readonly cacheIsNull?: boolean;
  readonly content?: string;
  readonly headings?: readonly HeadingCache[];
  readonly isPathIgnored?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
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
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('../locked-transaction.ts', () => ({
  runLockedTransaction: vi.fn()
}));

vi.mock('../modals/reorder-headings-modal.ts', () => ({
  openReorderHeadingsModal: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockRunLockedTransaction = vi.mocked(runLockedTransaction);
const mockOpenModal = vi.mocked(openReorderHeadingsModal);
const mockModify = vi.fn().mockResolvedValue(undefined);

const FILE = castTo<TFile>({ path: 'note.md' });

function heading(level: number, text: string, offset: number): HeadingCache {
  return castTo<HeadingCache>({ heading: text, level, position: { start: { offset } } });
}

const TWO_SECTION_CONTENT = '# A\naaa\n# B\nbbb\n';
const TWO_SECTION_HEADINGS: HeadingCache[] = [heading(1, 'A', 0), heading(1, 'B', 8)];

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({});
}

function createMockParams(options: CreateParamsOptions = {}): HandlerParams {
  return {
    app: strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn().mockReturnValue(options.cacheIsNull ? null : { headings: options.headings ?? [] })
      }),
      vault: strictProxy<Vault>({
        read: vi.fn().mockResolvedValue(options.content ?? TWO_SECTION_CONTENT)
      })
    }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }), showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(options.isPathIgnored ?? false),
        shouldAddCommandsToSubmenu: true,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(options.shouldBlockCommandOnPath ?? false),
        shouldShowOperationNotices: true
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function getShownNoticeText(pluginNoticeComponent: PluginNoticeComponent): string {
  const [content] = vi.mocked(pluginNoticeComponent.showNotice).mock.lastCall ?? [];
  return castTo<DocumentFragment>(content).textContent;
}

function toTestable(handler: ReorderHeadingsEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('ReorderHeadingsEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealFragments();
    mockRunLockedTransaction.mockImplementation(async (params: RunLockedTransactionParams) => {
      await params.body(strictProxy<VaultTransaction>({ modify: mockModify }));
    });
  });

  it('should construct with correct params', () => {
    const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('reorder-headings');
    expect(handler.name).toBe('Reorder headings...');
    expect(handler.icon).toBe('lucide-list-ordered');
  });

  describe('canExecuteEditor', () => {
    it('should be unavailable when context.file is null', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams()));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(null))).toBe(false);
    });

    it('should be unavailable without a reorderable sibling group', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ headings: [heading(1, 'A', 0)] })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(FILE))).toBe(false);
    });

    it('should be unavailable when the file has no metadata cache', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ cacheIsNull: true })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(FILE))).toBe(false);
    });

    it('should be available with two or more top-level headings', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ headings: TWO_SECTION_HEADINGS })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(FILE))).toBe(true);
    });

    it('should be available with two or more nested siblings under one parent', () => {
      const headings = [heading(1, 'A', 0), heading(2, 'A.1', 4), heading(2, 'A.2', 12)];
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ headings })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(FILE))).toBe(true);
    });

    it('should be unavailable when the command is blocked on the path', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ headings: TWO_SECTION_HEADINGS, shouldBlockCommandOnPath: true })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(FILE))).toBe(false);
    });
  });

  describe('executeEditor', () => {
    it('should return early when context.file is null', async () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams()));
      await handler.executeEditor(createMockEditor(), createMockContext(null));
      expect(mockOpenModal).not.toHaveBeenCalled();
    });

    it('should notice when the path is ignored', async () => {
      const params = createMockParams({ headings: TWO_SECTION_HEADINGS, isPathIgnored: true });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));

      const mockFragment = strictProxy<DocumentFragment>({ append: vi.fn(), appendChild: vi.fn(), appendText: vi.fn() });
      mockCreateFragmentAsync.mockImplementation(async (callback) => {
        await (callback as (f: DocumentFragment) => Promise<void>)(mockFragment);
        return mockFragment;
      });
      mockRenderInternalLink.mockResolvedValue(createEl('a'));

      await handler.executeEditor(createMockEditor(), createMockContext(FILE));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
      expect(mockOpenModal).not.toHaveBeenCalled();
    });

    it('should do nothing when the modal is cancelled', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue(null);

      await handler.executeEditor(createMockEditor(), createMockContext(FILE));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should not rewrite when the order is unchanged', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue([0, 1]);

      await handler.executeEditor(createMockEditor(), createMockContext(FILE));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should rewrite the note with the reordered sections', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue([1, 0]);

      await handler.executeEditor(createMockEditor(), createMockContext(FILE));

      expect(mockRunLockedTransaction).toHaveBeenCalledOnce();
      expect(mockModify).toHaveBeenCalledWith(FILE, '# B\nbbb\n\n# A\naaa\n');
      expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Reordered headings in note [note.md].');
    });

    it('should report nothing when the operation is cancelled', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue([1, 0]);
      mockRunLockedTransaction.mockImplementation((transactionParams: RunLockedTransactionParams) => {
        transactionParams.abortController.abort();
        return Promise.reject(new Error('cancelled'));
      });

      await handler.executeEditor(createMockEditor(), createMockContext(FILE));

      expect(params.pluginNoticeComponent.showNotice).not.toHaveBeenCalled();
    });

    it('should rethrow a failure that is not a cancellation', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue([1, 0]);
      mockRunLockedTransaction.mockRejectedValue(new Error('disk on fire'));

      await expect(handler.executeEditor(createMockEditor(), createMockContext(FILE))).rejects.toThrow('disk on fire');
      expect(params.pluginNoticeComponent.showNotice).not.toHaveBeenCalled();
    });
  });

  it('should add to the editor menu and reflect the submenu setting', () => {
    const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams()));
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
