import type {
  App,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
  MetadataCache,
  TFile,
  Vault
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

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
}

interface HandlerParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
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

function createMockCtx(file: null | TFile): MarkdownFileInfo {
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
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(options.isPathIgnored ?? false),
        shouldAddCommandsToSubmenu: true
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function toTestable(handler: ReorderHeadingsEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('ReorderHeadingsEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it('should be unavailable when ctx.file is null', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams()));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(null))).toBe(false);
    });

    it('should be unavailable with fewer than two top-level headings', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ headings: [heading(1, 'A', 0)] })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(FILE))).toBe(false);
    });

    it('should be unavailable when the file has no metadata cache', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ cacheIsNull: true })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(FILE))).toBe(false);
    });

    it('should be available with two or more top-level headings', () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams({ headings: TWO_SECTION_HEADINGS })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(FILE))).toBe(true);
    });
  });

  describe('executeEditor', () => {
    it('should return early when ctx.file is null', async () => {
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams()));
      await handler.executeEditor(createMockEditor(), createMockCtx(null));
      expect(mockOpenModal).not.toHaveBeenCalled();
    });

    it('should notice when the path is ignored', async () => {
      const params = createMockParams({ headings: TWO_SECTION_HEADINGS, isPathIgnored: true });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));

      const mockFragment = strictProxy<DocumentFragment>({ appendChild: vi.fn(), appendText: vi.fn() });
      mockCreateFragmentAsync.mockImplementation(async (cb) => {
        await (cb as (f: DocumentFragment) => Promise<void>)(mockFragment);
        return mockFragment;
      });
      mockRenderInternalLink.mockResolvedValue(createEl('a'));

      await handler.executeEditor(createMockEditor(), createMockCtx(FILE));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
      expect(mockOpenModal).not.toHaveBeenCalled();
    });

    it('should do nothing when the modal is cancelled', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue(null);

      await handler.executeEditor(createMockEditor(), createMockCtx(FILE));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should not rewrite when the order is unchanged', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue([0, 1]);

      await handler.executeEditor(createMockEditor(), createMockCtx(FILE));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should rewrite the note with the reordered sections', async () => {
      const params = createMockParams({ content: TWO_SECTION_CONTENT, headings: TWO_SECTION_HEADINGS });
      const handler = toTestable(new ReorderHeadingsEditorCommandHandler(params));
      mockOpenModal.mockResolvedValue([1, 0]);

      await handler.executeEditor(createMockEditor(), createMockCtx(FILE));

      expect(mockRunLockedTransaction).toHaveBeenCalledOnce();
      expect(mockModify).toHaveBeenCalledWith(FILE, '# B\nbbb\n\n# A\naaa\n');
    });
  });

  it('should add to the editor menu and reflect the submenu setting', () => {
    const handler = toTestable(new ReorderHeadingsEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });
});
