import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { EditBacklinksSnapshotParams } from '@mnaoumov/obsidian-lib/link';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type {
  App,
  CachedMetadata,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  ReferenceCache,
  TFile,
  TFolder
} from 'obsidian';

import {
  editBacklinksSnapshot,
  generateMarkdownLink
} from '@mnaoumov/obsidian-lib/link';
import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { RunLockedTransactionParams } from '../composers/locked-transaction.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../settings/plugin-settings.ts';
import type { ShowOperationProgressNoticeParams } from '../ui/operation-notices.ts';

import { runLockedTransaction } from '../composers/locked-transaction.ts';
import { isEditorCommandBlocked } from '../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../settings/command-visibility/command-menu-placement.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../ui/operation-notices.ts';
import { relocateAttachments } from './attachments.ts';
import { ExtractAttachmentIntoNoteEditorCommandHandler } from './extract-attachment-into-note-editor-command-handler.ts';
import {
  countReferences,
  findAttachmentReferenceAtCursor,
  findBlockIdOnLine
} from './extract-attachment-into-note.ts';

interface BuildBacklinksSnapshotParamsStub {
  readonly payloadProvider: () => unknown;
}

vi.mock('@mnaoumov/obsidian-lib/link', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/link')>(),
  buildBacklinksSnapshot: vi.fn((params: BuildBacklinksSnapshotParamsStub) => {
    params.payloadProvider();
    return 'snapshot';
  }),
  editBacklinksSnapshot: vi.fn(),
  generateMarkdownLink: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn().mockResolvedValue('backlinks'),
  getCacheSafe: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/vault', () => ({
  getAvailablePath: vi.fn((_app: unknown, path: string) => path)
}));

vi.mock('../composers/locked-transaction.ts', () => ({
  runLockedTransaction: vi.fn()
}));

vi.mock('../settings/command-visibility/command-block.ts', () => ({
  isEditorCommandBlocked: vi.fn()
}));

vi.mock('../settings/command-visibility/command-menu-placement.ts', () => ({
  checkShouldAddCommandToEditorMenu: vi.fn().mockReturnValue(true),
  checkShouldAddCommandToViewportMenu: vi.fn().mockReturnValue(false)
}));

vi.mock('../ui/operation-notices.ts', () => ({
  buildOperationNoticeContent: vi.fn().mockResolvedValue('content'),
  disposeOperationProgressNotice: vi.fn(),
  showOperationCompletionNotice: vi.fn(),
  showOperationProgressNotice: vi.fn()
}));

vi.mock('./attachments.ts', () => ({
  relocateAttachments: vi.fn()
}));

vi.mock('./extract-attachment-into-note.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./extract-attachment-into-note.ts')>(),
  countReferences: vi.fn(),
  findAttachmentReferenceAtCursor: vi.fn(),
  findBlockIdOnLine: vi.fn()
}));

const mockCountReferences = vi.mocked(countReferences);
const mockEditBacklinksSnapshot = vi.mocked(editBacklinksSnapshot);
const mockFindAttachmentReferenceAtCursor = vi.mocked(findAttachmentReferenceAtCursor);
const mockFindBlockIdOnLine = vi.mocked(findBlockIdOnLine);
const mockGenerateMarkdownLink = vi.mocked(generateMarkdownLink);
const mockGetCacheSafe = vi.mocked(getCacheSafe);
const isEditorCommandBlockedMock = vi.mocked(isEditorCommandBlocked);
const mockRunLockedTransaction = vi.mocked(runLockedTransaction);
const mockShowOperationCompletionNotice = vi.mocked(showOperationCompletionNotice);

const PARENT_CONTENT = 'Attachments:\n\n- ![[pic.png|March invoice]] ^inv\n';
const EMBED = '![[pic.png|March invoice]]';
const EMBED_OFFSET = PARENT_CONTENT.indexOf(EMBED);

const ATTACHMENT = strictProxy<TFile>({ basename: 'pic', name: 'pic.png', path: 'Docs/sub/pic.png' });
const NOTE_FILE = strictProxy<TFile>({ path: 'Docs/March invoice.md' });
const PARENT_FILE = strictProxy<TFile>({ parent: strictProxy<TFolder>({ path: 'Docs' }), path: 'Docs/parent.md' });
const CACHE = strictProxy<CachedMetadata>({});

const REFERENCE: ReferenceCache = {
  link: 'pic.png',
  original: EMBED,
  position: {
    end: { col: 2 + EMBED.length, line: 2, offset: EMBED_OFFSET + EMBED.length },
    start: { col: 2, line: 2, offset: EMBED_OFFSET }
  }
};

interface Harness {
  readonly handler: TestableHandler;
  readonly modify: ReturnType<typeof vi.fn>;
  readonly parentWrites: string[];
  readonly showNotice: ReturnType<typeof vi.fn>;
}

interface TestableHandler {
  readonly canExecuteEditor: (editor: Editor, context: MarkdownFileInfo) => boolean;
  readonly executeEditor: (editor: Editor, context: MarkdownFileInfo) => Promise<void>;
  readonly id: string;
  readonly name: string;
  readonly shouldAddCommandToSubmenu: () => boolean;
  readonly shouldAddToEditorMenu: () => boolean;
  readonly shouldAddToViewportMenu: (view: MarkdownView, mode: string, source: string) => boolean;
}

let progressContent: Promise<unknown> = Promise.resolve(null);

const editor = strictProxy<Editor>({ getCursor: () => ({ ch: 5, line: 2 }) });

function createContext(file: null | TFile = PARENT_FILE): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createHarness(): Harness {
  const settings = strictProxy<PluginSettings>({
    attachmentExtensions: [],
    replacement: '_',
    shouldAddCommandsToSubmenu: true
  });
  const getFileCache = vi.fn().mockReturnValue(CACHE);
  const showNotice = vi.fn();
  const parentWrites: string[] = [];
  let parentContent = PARENT_CONTENT;
  const modify = vi.fn();
  const vaultTransaction = strictProxy<VaultTransaction>({
    create: vi.fn().mockResolvedValue(NOTE_FILE),
    modify,
    process: vi.fn((_file: TFile, function_: (content: string) => string) => {
      parentContent = function_(parentContent);
      parentWrites.push(parentContent);
      return Promise.resolve(parentContent);
    })
  });
  mockRunLockedTransaction.mockImplementation(async (transactionParams: RunLockedTransactionParams) => {
    await transactionParams.body(vaultTransaction);
  });
  const handler = castTo<TestableHandler>(
    new ExtractAttachmentIntoNoteEditorCommandHandler({
      app: strictProxy<App>({ metadataCache: { getFileCache } }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }),
      resourceLockComponent: strictProxy<ResourceLockComponent>({})
    })
  );
  return { handler, modify, parentWrites, showNotice };
}

describe('ExtractAttachmentIntoNoteEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEditorCommandBlockedMock.mockReturnValue(false);
    mockGetCacheSafe.mockResolvedValue(CACHE);
    mockFindAttachmentReferenceAtCursor.mockReturnValue({ attachment: ATTACHMENT, reference: REFERENCE });
    mockCountReferences.mockReturnValue(1);
    mockFindBlockIdOnLine.mockReturnValue(null);
    mockGenerateMarkdownLink.mockImplementation(({ isEmbed }) => isEmbed ? '![[Docs/March invoice/pic.png]]' : '[[March invoice]]');
    vi.mocked(showOperationProgressNotice).mockImplementation((params: ShowOperationProgressNoticeParams) => {
      progressContent = Promise.resolve(castTo<() => unknown>(params.content)());
      return null;
    });
  });

  it('should construct with correct params', () => {
    const { handler } = createHarness();
    expect(handler.id).toBe('extract-attachment-into-own-note');
    expect(handler.name).toBe('Extract attachment into its own note');
  });

  it('should delegate the menu placement and the submenu flag to the settings', () => {
    const { handler } = createHarness();
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(handler.shouldAddToEditorMenu()).toBe(true);
    expect(handler.shouldAddToViewportMenu(strictProxy<MarkdownView>({}), 'source', '')).toBe(false);
    expect(vi.mocked(checkShouldAddCommandToEditorMenu)).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'extract-attachment-into-own-note' }));
    expect(vi.mocked(checkShouldAddCommandToViewportMenu)).toHaveBeenCalledWith(expect.objectContaining({ mode: 'source' }));
  });

  describe('canExecuteEditor', () => {
    it('should be offered on an attachment reference', () => {
      expect(createHarness().handler.canExecuteEditor(editor, createContext())).toBe(true);
    });

    it('should not be offered when the command is blocked', () => {
      isEditorCommandBlockedMock.mockReturnValue(true);
      expect(createHarness().handler.canExecuteEditor(editor, createContext())).toBe(false);
    });

    it('should not be offered without a file, or away from an attachment', () => {
      const { handler } = createHarness();
      expect(handler.canExecuteEditor(editor, createContext(null))).toBe(false);
      mockFindAttachmentReferenceAtCursor.mockReturnValue(null);
      expect(handler.canExecuteEditor(editor, createContext())).toBe(false);
    });

    it('should not be offered while the note is not indexed', () => {
      const handler = castTo<TestableHandler>(
        new ExtractAttachmentIntoNoteEditorCommandHandler({
          app: strictProxy<App>({ metadataCache: { getFileCache: () => null } }),
          pluginNoticeComponent: strictProxy<PluginNoticeComponent>({}),
          pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings: strictProxy<PluginSettings>({}) }),
          resourceLockComponent: strictProxy<ResourceLockComponent>({})
        })
      );
      expect(handler.canExecuteEditor(editor, createContext())).toBe(false);
    });
  });

  describe('executeEditor refusals', () => {
    it('should do nothing without a file', async () => {
      await createHarness().handler.executeEditor(editor, createContext(null));
      expect(mockGetCacheSafe).not.toHaveBeenCalled();
    });

    it('should say so when there is no attachment under the cursor', async () => {
      const { handler, showNotice } = createHarness();
      mockFindAttachmentReferenceAtCursor.mockReturnValue(null);
      await handler.executeEditor(editor, createContext());
      mockGetCacheSafe.mockResolvedValue(null);
      await handler.executeEditor(editor, createContext());
      expect(showNotice).toHaveBeenCalledTimes(2);
      expect(showNotice).toHaveBeenCalledWith('No attachment under the cursor.');
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should refuse an attachment referenced more than once', async () => {
      const { handler, showNotice } = createHarness();
      mockCountReferences.mockReturnValue(2);
      await handler.executeEditor(editor, createContext());
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('is referenced from more than one place'));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });
  });

  describe('executeEditor extraction', () => {
    it('should create the note beside the parent, embed the attachment and link the note in its place', async () => {
      const { handler, modify, parentWrites } = createHarness();

      await handler.executeEditor(editor, createContext());

      expect(mockRunLockedTransaction).toHaveBeenCalledWith(expect.objectContaining({ lockTargets: [{ mode: 'file', pathOrFile: PARENT_FILE }] }));
      expect(vi.mocked(relocateAttachments)).toHaveBeenCalledWith(expect.objectContaining({
        relocations: [{ attachment: ATTACHMENT, newNoteFile: NOTE_FILE, oldNoteFile: PARENT_FILE }]
      }));
      expect(modify).toHaveBeenCalledWith(NOTE_FILE, '---\naliases:\n  - "March invoice"\n---\n\n![[Docs/March invoice/pic.png]]\n');
      expect(parentWrites).toEqual(['Attachments:\n\n- [[March invoice]] ^inv\n']);
      expect(mockEditBacklinksSnapshot).not.toHaveBeenCalled();
      expect(vi.mocked(buildOperationNoticeContent)).toHaveBeenLastCalledWith(expect.objectContaining({ suffix: '', targetPathOrAbstractFile: NOTE_FILE }));
      expect(mockShowOperationCompletionNotice).toHaveBeenCalledOnce();
      await expect(progressContent).resolves.toBe('content');
    });

    it('should name the note after the file and record no alias without link text, at the root without a parent', async () => {
      const { handler, modify } = createHarness();
      const rootParent = strictProxy<TFile>({ parent: null, path: 'parent.md' });
      // The name is read off the first lookup; the second, after the move, finds the parent's real embed.
      mockFindAttachmentReferenceAtCursor.mockReturnValueOnce({ attachment: ATTACHMENT, reference: { ...REFERENCE, original: '![[pic.png]]' } });

      await handler.executeEditor(editor, createContext(rootParent));

      expect(vi.mocked(getCacheSafe)).toHaveBeenCalledWith(expect.anything(), rootParent);
      expect(modify).toHaveBeenCalledWith(NOTE_FILE, '![[Docs/March invoice/pic.png]]\n');
    });

    it('should point every link to the block at the new note, keep each display text and drop the block id', async () => {
      const { handler, parentWrites } = createHarness();
      mockFindBlockIdOnLine.mockReturnValue('inv');
      const converted: (null | string | undefined)[] = [];
      mockEditBacklinksSnapshot.mockImplementation(async (params: EditBacklinksSnapshotParams<undefined>) => {
        const converter = params.referenceConverter;
        for (const original of ['[[parent#^inv|the invoice]]', '![[parent#^inv]]', '[[parent]]', 'parent#^inv']) {
          const link = original.replace(/^!?\[\[/, '').replace(/(?:\|.*)?\]\]$/, '');
          converted.push(await converter({ reference: { link, original }, sourcePath: 'linker.md' }));
        }
      });
      mockGenerateMarkdownLink.mockImplementation((params) => `${params.isEmbed ? '!' : ''}[[March invoice${params.alias === undefined ? '' : `|${params.alias}`}]]`);

      await handler.executeEditor(editor, createContext());

      expect(converted).toEqual(['[[March invoice|the invoice]]', '![[March invoice]]', null, '[[March invoice]]']);
      expect(parentWrites.at(-1)).toBe('Attachments:\n\n- [[March invoice]]\n');
      expect(vi.mocked(buildOperationNoticeContent)).toHaveBeenLastCalledWith(expect.objectContaining({ suffix: ' and updated 3 link(s)' }));
    });

    it('should fail when the reference is not found again after the move', async () => {
      const { handler } = createHarness();
      mockFindAttachmentReferenceAtCursor.mockReturnValueOnce({ attachment: ATTACHMENT, reference: REFERENCE }).mockReturnValueOnce(null);
      await expect(handler.executeEditor(editor, createContext())).rejects.toThrow('Could not find the reference');
    });

    it('should fail when the note is not indexed after the move', async () => {
      const { handler } = createHarness();
      mockGetCacheSafe.mockResolvedValueOnce(CACHE).mockResolvedValueOnce(null);
      await expect(handler.executeEditor(editor, createContext())).rejects.toThrow('Could not find the reference');
    });

    it('should stay silent when the operation is cancelled', async () => {
      const { handler } = createHarness();
      mockRunLockedTransaction.mockImplementation((params: RunLockedTransactionParams) => {
        params.abortController.abort();
        return Promise.reject(new Error('aborted'));
      });

      await handler.executeEditor(editor, createContext());

      expect(mockShowOperationCompletionNotice).not.toHaveBeenCalled();
    });

    it('should rethrow a failure that is not a cancel', async () => {
      const { handler } = createHarness();
      mockRunLockedTransaction.mockRejectedValue(new Error('boom'));
      await expect(handler.executeEditor(editor, createContext())).rejects.toThrow('boom');
    });

    it('should report nothing when the transaction body never ran', async () => {
      const { handler } = createHarness();
      mockRunLockedTransaction.mockResolvedValue(undefined);
      await handler.executeEditor(editor, createContext());
      expect(mockShowOperationCompletionNotice).not.toHaveBeenCalled();
    });
  });
});
