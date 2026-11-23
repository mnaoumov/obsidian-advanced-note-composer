import type { FileCommandHandlerShouldAddToFileMenuParams } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  EditBacklinksSnapshotParams,
  GenerateMarkdownLinkParams
} from '@mnaoumov/obsidian-lib/link';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type {
  App,
  Reference,
  ReferenceCache,
  TFile
} from 'obsidian';

import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
import {
  editBacklinksSnapshot,
  generateMarkdownLink
} from '@mnaoumov/obsidian-lib/link';
import {
  getBacklinksForFileSafe,
  getCacheSafe
} from '@mnaoumov/obsidian-lib/metadata-cache';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
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
import type { ConfirmDialogModalResult } from '../ui/confirm-dialog-modal.ts';
import type { ShowOperationProgressNoticeParams } from '../ui/operation-notices.ts';
import type { AttachmentNoteAnalysis } from './inline-attachment-note.ts';

import { registerCommandHandlerStub } from '../command-handler-registration-stub.ts';
import { runLockedTransaction } from '../composers/locked-transaction.ts';
import { isFileOrFolderCommandBlocked } from '../settings/command-visibility/command-block.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../ui/operation-notices.ts';
import { relocateAttachments } from './attachments.ts';
import {
  countReferences,
  findBlockIdOnLine
} from './extract-attachment-into-note.ts';
import {
  buildDropsConfirmContent,
  InlineAttachmentNoteCommandHandler
} from './inline-attachment-note-command-handler.ts';
import {
  analyzeAttachmentNote,
  findAttachmentNoteReference,
  findBlockEndLine,
  findParentCandidates,
  findReferencesToNote,
  generateBlockId
} from './inline-attachment-note.ts';
import { selectParentNote } from './select-parent-note-modal.ts';

interface BuildBacklinksSnapshotParamsStub {
  readonly payloadProvider: () => unknown;
}

interface CapturedConfirmParams {
  readonly buildContent: (fragment: DocumentFragment) => Promise<void>;
  readonly promiseResolve: (result: ConfirmDialogModalResult) => void;
}

vi.mock('@mnaoumov/obsidian-lib/file-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mnaoumov/obsidian-lib/file-system')>()),
  isMarkdownFile: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mnaoumov/obsidian-lib/link')>()),
  buildBacklinksSnapshot: vi.fn((params: BuildBacklinksSnapshotParamsStub) => {
    params.payloadProvider();
    return 'snapshot';
  }),
  editBacklinksSnapshot: vi.fn(),
  generateMarkdownLink: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn(),
  getCacheSafe: vi.fn()
}));

vi.mock('../composers/locked-transaction.ts', () => ({
  runLockedTransaction: vi.fn()
}));

vi.mock('../settings/command-visibility/command-block.ts', () => ({
  isFileOrFolderCommandBlocked: vi.fn()
}));

vi.mock('../ui/confirm-dialog-modal.ts', () => ({
  ConfirmDialogModal: class {
    public readonly params: CapturedConfirmParams;

    public constructor(params: CapturedConfirmParams) {
      this.params = params;
      capturedConfirmParams = params;
    }
  }
}));

vi.mock('../ui/open-minimizable-modal.ts', () => ({
  openConfirmDialogModal: vi.fn(() => {
    capturedConfirmParams?.promiseResolve(castTo<ConfirmDialogModalResult>({ isConfirmed: isConfirmAnswer }));
  })
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
  ...(await importOriginal<typeof import('./extract-attachment-into-note.ts')>()),
  countReferences: vi.fn(),
  findBlockIdOnLine: vi.fn()
}));

vi.mock('./inline-attachment-note.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./inline-attachment-note.ts')>()),
  analyzeAttachmentNote: vi.fn(),
  findAttachmentNoteReference: vi.fn(),
  findBlockEndLine: vi.fn(),
  findParentCandidates: vi.fn(),
  findReferencesToNote: vi.fn(),
  generateBlockId: vi.fn()
}));

vi.mock('./select-parent-note-modal.ts', () => ({
  selectParentNote: vi.fn()
}));

const mockAnalyzeAttachmentNote = vi.mocked(analyzeAttachmentNote);
const mockCountReferences = vi.mocked(countReferences);
const mockEditBacklinksSnapshot = vi.mocked(editBacklinksSnapshot);
const mockFindBlockIdOnLine = vi.mocked(findBlockIdOnLine);
const mockFindParentCandidates = vi.mocked(findParentCandidates);
const mockFindReferencesToNote = vi.mocked(findReferencesToNote);
const mockGetCacheSafe = vi.mocked(getCacheSafe);
const mockRunLockedTransaction = vi.mocked(runLockedTransaction);
const mockSelectParentNote = vi.mocked(selectParentNote);
const mockShowOperationCompletionNotice = vi.mocked(showOperationCompletionNotice);

const PARENT_CONTENT = 'Attachments:\n\n- [[Invoice]]\n';
const MAIN_LINK = '[[Invoice]]';
const MAIN_OFFSET = PARENT_CONTENT.indexOf(MAIN_LINK);

const ATTACHMENT = strictProxy<TFile>({ name: 'pic.png', path: 'Docs/pic.png' });
const NOTE_FILE = strictProxy<TFile>({ basename: 'Invoice', path: 'Docs/Invoice.md' });
const PARENT_FILE = strictProxy<TFile>({ path: 'Docs/parent.md' });
const OTHER_PARENT = strictProxy<TFile>({ path: 'other.md' });
type CacheEx = NonNullable<Awaited<ReturnType<typeof getCacheSafe>>>;

const NOTE_CACHE = castTo<CacheEx>({ note: true });
const PARENT_CACHE = castTo<CacheEx>({ blocks: { old: {} } });

const MAIN_REFERENCE: ReferenceCache = {
  link: 'Invoice',
  original: MAIN_LINK,
  position: {
    end: { col: 2 + MAIN_LINK.length, line: 2, offset: MAIN_OFFSET + MAIN_LINK.length },
    start: { col: 2, line: 2, offset: MAIN_OFFSET }
  }
};

const ANALYSIS: AttachmentNoteAnalysis = {
  attachment: ATTACHMENT,
  droppedAliases: [],
  droppedProperties: [],
  droppedText: '',
  isEmbed: true,
  linkText: 'March invoice'
};

let capturedConfirmParams: CapturedConfirmParams | null = null;
let isConfirmAnswer = true;
let progressContent: Promise<unknown> = Promise.resolve(null);
let backlinkMap = new Map<string, Reference[]>();

interface Harness {
  readonly handler: TestableHandler;
  readonly parentWrites: string[];
  readonly showNotice: ReturnType<typeof vi.fn>;
  readonly trash: ReturnType<typeof vi.fn>;
}

interface TestableHandler {
  readonly canExecuteFile: (file: TFile) => boolean;
  readonly executeFile: (file: TFile) => Promise<void>;
  readonly id: string;
  readonly name: string;
  readonly shouldAddCommandToSubmenu: () => boolean;
  readonly shouldAddToFileMenu: (params: FileCommandHandlerShouldAddToFileMenuParams) => boolean;
}

function createHarness(getFileCache: () => CacheEx | null = () => NOTE_CACHE): Harness {
  const settings = strictProxy<PluginSettings>({
    attachmentExtensions: [],
    shouldAddCommandsToSubmenu: true
  });
  const showNotice = vi.fn();
  const parentWrites: string[] = [];
  let parentContent = PARENT_CONTENT;
  const trash = vi.fn();
  const vaultTransaction = strictProxy<VaultTransaction>({
    process: vi.fn((_pathOrFile: unknown, function_: (content: string) => string) => {
      parentContent = function_(parentContent);
      parentWrites.push(parentContent);
      return noopAsync();
    }),
    trash
  });
  mockRunLockedTransaction.mockImplementation(async (transactionParams: RunLockedTransactionParams) => {
    await transactionParams.body(vaultTransaction);
  });
  const handler = castTo<TestableHandler>(
    new InlineAttachmentNoteCommandHandler({
      app: strictProxy<App>({
        metadataCache: { getFileCache },
        vault: { read: vi.fn().mockResolvedValue('note content') }
      }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }),
      resourceLockComponent: strictProxy<ResourceLockComponent>({})
    })
  );
  return { handler, parentWrites, showNotice, trash };
}

function linkTo(original: string): ReferenceCache {
  return {
    link: original.replace(/^!?\[\[/, '').replace(/(?:\|.*)?\]\]$/, ''),
    original,
    position: { end: { col: 0, line: 0, offset: original.length }, start: { col: 0, line: 0, offset: 0 } }
  };
}

describe('InlineAttachmentNoteCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfirmParams = null;
    isConfirmAnswer = true;
    backlinkMap = new Map([[PARENT_FILE.path, [MAIN_REFERENCE]]]);
    vi.mocked(isMarkdownFile).mockReturnValue(true);
    vi.mocked(isFileOrFolderCommandBlocked).mockReturnValue(false);
    vi.mocked(findAttachmentNoteReference).mockReturnValue({ attachment: ATTACHMENT, reference: MAIN_REFERENCE });
    vi.mocked(getBacklinksForFileSafe).mockImplementation(() =>
      Promise.resolve(castTo<Awaited<ReturnType<typeof getBacklinksForFileSafe>>>({
        get: (key: string) => backlinkMap.get(key),
        keys: () => backlinkMap.keys()
      }))
    );
    vi.mocked(findBlockEndLine).mockReturnValue(2);
    vi.mocked(generateBlockId).mockReturnValue('new1');
    mockAnalyzeAttachmentNote.mockReturnValue(ANALYSIS);
    mockCountReferences.mockReturnValue(1);
    mockFindParentCandidates.mockReturnValue([{ file: PARENT_FILE, isFromList: false }]);
    mockFindReferencesToNote.mockReturnValue([MAIN_REFERENCE]);
    mockFindBlockIdOnLine.mockReturnValue(null);
    mockGetCacheSafe.mockImplementation((_app, pathOrFile) => Promise.resolve(pathOrFile === NOTE_FILE ? NOTE_CACHE : PARENT_CACHE));
    vi.mocked(generateMarkdownLink).mockImplementation((params: GenerateMarkdownLinkParams) => {
      const target = params.targetPathOrFile === ATTACHMENT ? 'pic.png' : 'parent';
      const alias = params.alias === undefined ? '' : `|${params.alias}`;
      return `${params.isEmbed ? '!' : ''}[[${target}${params.subpath ?? ''}${alias}]]`;
    });
    vi.mocked(showOperationProgressNotice).mockImplementation((params: ShowOperationProgressNoticeParams) => {
      progressContent = Promise.resolve(castTo<() => unknown>(params.content)());
      return null;
    });
  });

  it('should construct with correct params', () => {
    const { handler } = createHarness();
    expect(handler.id).toBe('inline-attachment-note-into-parent');
    expect(handler.name).toBe('Inline attachment note into its parent');
  });

  it('should always add the command to the file menu', () => {
    expect(createHarness().handler.shouldAddToFileMenu({ file: NOTE_FILE, source: 'file-explorer' })).toBe(true);
  });

  it('should keep a submenu answer the registering menu surface forced off, and use the setting when it set none', async () => {
    const forcedOff = createHarness().handler;
    await registerCommandHandlerStub({ handler: forcedOff, shouldAddCommandToSubmenu: false });
    expect(forcedOff.shouldAddCommandToSubmenu()).toBe(false);

    const unset = createHarness().handler;
    await registerCommandHandlerStub({ handler: unset });
    expect(unset.shouldAddCommandToSubmenu()).toBe(true);
  });

  describe('canExecuteFile', () => {
    it('should be offered on an attachment note some note links', () => {
      expect(createHarness().handler.canExecuteFile(NOTE_FILE)).toBe(true);
    });

    it('should not be offered on a non-note, a blocked path, a note not yet indexed, a plain note or an unlinked one', () => {
      const { handler } = createHarness();
      vi.mocked(isMarkdownFile).mockReturnValueOnce(false);
      expect(handler.canExecuteFile(NOTE_FILE)).toBe(false);
      vi.mocked(isFileOrFolderCommandBlocked).mockReturnValueOnce(true);
      expect(handler.canExecuteFile(NOTE_FILE)).toBe(false);
      expect(createHarness(() => null).handler.canExecuteFile(NOTE_FILE)).toBe(false);
      vi.mocked(findAttachmentNoteReference).mockReturnValueOnce(null);
      expect(handler.canExecuteFile(NOTE_FILE)).toBe(false);
      mockFindParentCandidates.mockReturnValueOnce([]);
      expect(handler.canExecuteFile(NOTE_FILE)).toBe(false);
    });
  });

  describe('executeFile refusals', () => {
    it('should refuse a note that is not an attachment note, indexed or not', async () => {
      const { handler, showNotice } = createHarness();
      mockAnalyzeAttachmentNote.mockReturnValueOnce(null);
      await handler.executeFile(NOTE_FILE);
      mockGetCacheSafe.mockResolvedValueOnce(null);
      await handler.executeFile(NOTE_FILE);
      expect(showNotice).toHaveBeenCalledTimes(2);
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('is not an attachment note'));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should refuse an attachment referenced from anywhere else', async () => {
      const { handler, showNotice } = createHarness();
      mockCountReferences.mockReturnValue(2);
      await handler.executeFile(NOTE_FILE);
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('is referenced from more than one place'));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should refuse a note nothing links', async () => {
      const { handler, showNotice } = createHarness();
      mockFindParentCandidates.mockReturnValue([]);
      await handler.executeFile(NOTE_FILE);
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('has no parent'));
    });

    it('should ask which note is the parent when several link it, and stop when the picker is dismissed', async () => {
      const { handler } = createHarness();
      mockFindParentCandidates.mockReturnValue([{ file: PARENT_FILE, isFromList: true }, { file: OTHER_PARENT, isFromList: true }]);
      mockSelectParentNote.mockResolvedValue(null);
      await handler.executeFile(NOTE_FILE);
      expect(mockSelectParentNote).toHaveBeenCalledWith(expect.objectContaining({ candidates: [PARENT_FILE, OTHER_PARENT] }));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should take the one note linking from a list item without asking', async () => {
      const { handler, trash } = createHarness();
      mockFindParentCandidates.mockReturnValue([{ file: PARENT_FILE, isFromList: true }, { file: OTHER_PARENT, isFromList: false }]);
      await handler.executeFile(NOTE_FILE);
      expect(mockSelectParentNote).not.toHaveBeenCalled();
      expect(trash).toHaveBeenCalledWith(NOTE_FILE);
    });

    it('should refuse when the parent no longer links the note', async () => {
      const { handler, showNotice } = createHarness();
      mockFindReferencesToNote.mockReturnValueOnce([]);
      await handler.executeFile(NOTE_FILE);
      mockGetCacheSafe.mockImplementation((_app, pathOrFile) => Promise.resolve(pathOrFile === NOTE_FILE ? NOTE_CACHE : null));
      await handler.executeFile(NOTE_FILE);
      expect(showNotice).toHaveBeenCalledTimes(2);
      expect(showNotice).toHaveBeenCalledWith('Docs/parent.md no longer links Docs/Invoice.md.');
    });

    it('should list what would be dropped and stop when the user cancels', async () => {
      const { handler } = createHarness();
      mockAnalyzeAttachmentNote.mockReturnValue({ ...ANALYSIS, droppedAliases: ['Scan'], droppedProperties: ['tags'], droppedText: 'Intro' });
      isConfirmAnswer = false;
      await handler.executeFile(NOTE_FILE);
      expect(capturedConfirmParams).not.toBeNull();
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();

      const fragment = createFragment();
      await capturedConfirmParams?.buildContent(fragment);
      expect(fragment.textContent).toBe('Inlining Docs/Invoice.md trashes it, and with it:Aliases: ScanProperties: tagsText: Intro');
    });
  });

  describe('buildDropsConfirmContent', () => {
    it('should list only what is dropped', () => {
      const fragment = createFragment();
      buildDropsConfirmContent({ analysis: { ...ANALYSIS, droppedAliases: ['Scan'] }, fragment, noteFile: NOTE_FILE });
      expect(fragment.querySelectorAll('li')).toHaveLength(1);

      const propertiesOnly = createFragment();
      buildDropsConfirmContent({ analysis: { ...ANALYSIS, droppedProperties: ['tags'] }, fragment: propertiesOnly, noteFile: NOTE_FILE });
      expect(propertiesOnly.textContent).toContain('Properties: tags');
      expect(propertiesOnly.textContent).not.toContain('Aliases');
    });
  });

  describe('executeFile inline', () => {
    it('should move the attachment, put it on the parent\'s line and trash the note, with nothing else to rewrite', async () => {
      const { handler, parentWrites, trash } = createHarness();

      await handler.executeFile(NOTE_FILE);

      expect(mockRunLockedTransaction).toHaveBeenCalledWith(expect.objectContaining({
        lockTargets: [{ mode: 'file', pathOrFile: NOTE_FILE }, { mode: 'file', pathOrFile: PARENT_FILE }]
      }));
      expect(vi.mocked(relocateAttachments)).toHaveBeenCalledWith(expect.objectContaining({
        relocations: [{ attachment: ATTACHMENT, newNoteFile: PARENT_FILE, oldNoteFile: NOTE_FILE }]
      }));
      expect(parentWrites).toEqual(['Attachments:\n\n- ![[pic.png|March invoice]]\n']);
      expect(mockEditBacklinksSnapshot).not.toHaveBeenCalled();
      expect(trash).toHaveBeenCalledWith(NOTE_FILE);
      expect(vi.mocked(buildOperationNoticeContent)).toHaveBeenLastCalledWith(expect.objectContaining({ suffix: '', verb: 'Inlined pic.png from' }));
      expect(mockShowOperationCompletionNotice).toHaveBeenCalledOnce();
      await expect(progressContent).resolves.toBe('content');
    });

    it('should inline into the parent the user picked once dropping is confirmed, as a link without link text', async () => {
      const { handler, parentWrites } = createHarness();
      mockFindParentCandidates.mockReturnValue([{ file: PARENT_FILE, isFromList: true }, { file: OTHER_PARENT, isFromList: true }]);
      mockSelectParentNote.mockResolvedValue(PARENT_FILE);
      mockAnalyzeAttachmentNote.mockReturnValue({ ...ANALYSIS, droppedText: 'Intro', isEmbed: false, linkText: null });
      // A parent with no block ids yet.
      mockGetCacheSafe.mockImplementation((_app, pathOrFile) => Promise.resolve(pathOrFile === NOTE_FILE ? NOTE_CACHE : castTo<CacheEx>({})));

      await handler.executeFile(NOTE_FILE);

      expect(parentWrites).toEqual(['Attachments:\n\n- [[pic.png]]\n']);
    });

    it('should point every other link at a new block id, keeping display text, and append the id', async () => {
      const { handler, parentWrites } = createHarness();
      const originals = ['[[Invoice|the invoice]]', '![[Invoice]]', '[[Invoice]]'];
      backlinkMap.set('linker.md', originals.map((original) => linkTo(original)));
      backlinkMap.set(NOTE_FILE.path, [linkTo('[[Invoice]]')]);
      const converted: unknown[] = [];
      mockEditBacklinksSnapshot.mockImplementation(async (params: EditBacklinksSnapshotParams<unknown>) => {
        const converter = params.referenceConverter;
        for (const reference of [...originals.map((original) => linkTo(original)), { ...linkTo('[[Invoice]]'), displayText: 'Shown' }, { ...linkTo('Invoice'), displayText: 'Bare' }]) {
          converted.push(await converter(castTo<Parameters<typeof converter>[0]>({ reference, sourcePath: 'linker.md' })));
        }
        converted.push(await converter(castTo<Parameters<typeof converter>[0]>({ reference: MAIN_REFERENCE, sourcePath: PARENT_FILE.path })));
      });

      await handler.executeFile(NOTE_FILE);

      expect(vi.mocked(generateBlockId)).toHaveBeenCalledWith(new Set(['old']));
      expect(converted).toEqual([
        '[[parent#^new1|the invoice]]',
        '![[parent#^new1]]',
        '[[parent#^new1|Invoice]]',
        '[[parent#^new1|Shown]]',
        '[[parent#^new1|Bare]]',
        null
      ]);
      expect(parentWrites).toEqual(['Attachments:\n\n- ![[pic.png|March invoice]] ^new1\n']);
      expect(vi.mocked(buildOperationNoticeContent)).toHaveBeenLastCalledWith(expect.objectContaining({ suffix: ' and updated 5 link(s)' }));
    });

    it('should reuse the block id the parent\'s line already has', async () => {
      const { handler, parentWrites } = createHarness();
      mockFindBlockIdOnLine.mockReturnValue('kept');
      backlinkMap.set('linker.md', [linkTo('[[Invoice]]')]);
      backlinkMap.set('ghost.md', castTo<Reference[]>(undefined));

      await handler.executeFile(NOTE_FILE);

      expect(vi.mocked(generateBlockId)).not.toHaveBeenCalled();
      expect(mockEditBacklinksSnapshot).toHaveBeenCalledOnce();
      expect(parentWrites).toEqual(['Attachments:\n\n- ![[pic.png|March invoice]]\n']);
    });

    it('should fail when the parent\'s link is not found again after the rewrites', async () => {
      const { handler } = createHarness();
      mockFindReferencesToNote.mockReturnValueOnce([MAIN_REFERENCE]).mockReturnValueOnce([{ ...MAIN_REFERENCE, position: { ...MAIN_REFERENCE.position, start: { ...MAIN_REFERENCE.position.start, line: 7 } } }]);
      await expect(handler.executeFile(NOTE_FILE)).rejects.toThrow('Could not find the link');
    });

    it('should fail when the parent is not indexed after the rewrites', async () => {
      const { handler } = createHarness();
      mockGetCacheSafe.mockResolvedValueOnce(NOTE_CACHE).mockResolvedValueOnce(PARENT_CACHE).mockResolvedValueOnce(null);
      await expect(handler.executeFile(NOTE_FILE)).rejects.toThrow('Could not find the link');
    });

    it('should stay silent when the operation is cancelled', async () => {
      const { handler } = createHarness();
      mockRunLockedTransaction.mockImplementation((params: RunLockedTransactionParams) => {
        params.abortController.abort();
        return Promise.reject(new Error('aborted'));
      });
      await handler.executeFile(NOTE_FILE);
      expect(mockShowOperationCompletionNotice).not.toHaveBeenCalled();
    });

    it('should rethrow a failure that is not a cancel', async () => {
      const { handler } = createHarness();
      mockRunLockedTransaction.mockRejectedValue(new Error('boom'));
      await expect(handler.executeFile(NOTE_FILE)).rejects.toThrow('boom');
    });

    it('should report nothing when the transaction body never ran', async () => {
      const { handler } = createHarness();
      mockRunLockedTransaction.mockResolvedValue(undefined);
      await handler.executeFile(NOTE_FILE);
      expect(mockShowOperationCompletionNotice).not.toHaveBeenCalled();
    });
  });
});
