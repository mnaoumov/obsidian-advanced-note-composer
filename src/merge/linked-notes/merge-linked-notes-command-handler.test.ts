import type { FileCommandHandlerShouldAddToFileMenuParams } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  TFile
} from 'obsidian';

import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
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

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../../settings/plugin-settings.ts';
import type { ConfirmDialogModalResult } from '../../ui/confirm-dialog-modal.ts';
import type { LinkedNoteToMergeBack } from './linked-notes-to-merge-back.ts';

import { registerCommandHandlerStub } from '../../command-handler-registration-stub.ts';
import { isFileOrFolderCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import { mergeFilesIntoSingleFile } from '../merge-into-single-file-runner.ts';
import {
  findLinkedNotesToMergeBack,
  hasLinkedNoteCandidate
} from './linked-notes-to-merge-back.ts';
import {
  buildMergeLinkedNotesConfirmContent,
  MergeLinkedNotesCommandHandler
} from './merge-linked-notes-command-handler.ts';

interface CapturedConfirmParams {
  readonly buildContent: (fragment: DocumentFragment) => Promise<void>;
  readonly promiseResolve: (result: ConfirmDialogModalResult) => void;
}

interface RenderInternalLinkParamsStub {
  readonly pathOrAbstractFile: TFile;
}

vi.mock('@mnaoumov/obsidian-lib/file-system', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/file-system')>(),
  isMarkdownFile: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/markdown', () => ({
  renderInternalLink: vi.fn((params: RenderInternalLinkParamsStub) => Promise.resolve(createSpan({ text: params.pathOrAbstractFile.path })))
}));

vi.mock('../../settings/command-visibility/command-block.ts', () => ({
  isFileOrFolderCommandBlocked: vi.fn()
}));

vi.mock('../../ui/confirm-dialog-modal.ts', () => ({
  ConfirmDialogModal: class {
    public readonly params: CapturedConfirmParams;

    public constructor(params: CapturedConfirmParams) {
      this.params = params;
      capturedConfirmParams = params;
    }
  }
}));

vi.mock('../../ui/open-minimizable-modal.ts', () => ({
  openConfirmDialogModal: vi.fn(() => {
    capturedConfirmParams?.promiseResolve(castTo<ConfirmDialogModalResult>(confirmAnswer));
  })
}));

vi.mock('../merge-into-single-file-runner.ts', () => ({
  mergeFilesIntoSingleFile: vi.fn()
}));

vi.mock('./linked-notes-to-merge-back.ts', () => ({
  findLinkedNotesToMergeBack: vi.fn(),
  hasLinkedNoteCandidate: vi.fn()
}));

const TARGET_FILE = strictProxy<TFile>({ path: 'target.md' });
const NOTE_A = strictProxy<TFile>({ path: 'a.md' });
const NOTE_B = strictProxy<TFile>({ path: 'b.md' });

const LINKED_NOTES: LinkedNoteToMergeBack[] = [
  { file: NOTE_A, link: { endOffset: 5, line: 0, original: '[[a]]', startOffset: 0 } },
  { file: NOTE_B, link: { endOffset: 12, line: 2, original: '[[b]]', startOffset: 7 } }
];

let capturedConfirmParams: CapturedConfirmParams | null = null;
let confirmAnswer: Partial<ConfirmDialogModalResult> = { isConfirmed: true, shouldAskAgain: true };

interface Harness {
  readonly editAndSave: ReturnType<typeof vi.fn>;
  readonly handler: TestableHandler;
  readonly settings: PluginSettings;
  readonly showNotice: ReturnType<typeof vi.fn>;
}

interface TestableHandler {
  readonly canExecuteFile: (file: TFile) => boolean;
  readonly executeFile: (file: TFile) => Promise<void>;
  readonly id: string;
  readonly name: string;
  readonly shouldAddCommandToSubmenu: () => boolean;
  readonly shouldAddToFileMenu: (params: FileCommandHandlerShouldAddToFileMenuParams) => boolean;
}

function createHarness(settingsOverrides: Partial<PluginSettings> = {}): Harness {
  const settings = castTo<PluginSettings>({
    isPathIgnored: vi.fn(() => false),
    shouldAddCommandsToSubmenu: true,
    shouldAlwaysMergeExcludedItems: false,
    shouldAskBeforeMerging: true,
    shouldMoveAttachmentsWhenMergingFile: true,
    ...settingsOverrides
  });
  const showNotice = vi.fn();
  const editAndSave = vi.fn((editor: (settings: PluginSettings) => void) => {
    editor(settings);
    return noopAsync();
  });
  const handler = castTo<TestableHandler>(
    new MergeLinkedNotesCommandHandler({
      app: strictProxy<App>({}),
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ editAndSave, settings }),
      resourceLockComponent: strictProxy<ResourceLockComponent>({})
    })
  );
  return { editAndSave, handler, settings, showNotice };
}

describe('MergeLinkedNotesCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfirmParams = null;
    confirmAnswer = { isConfirmed: true, shouldAskAgain: true };
    vi.mocked(isMarkdownFile).mockReturnValue(true);
    vi.mocked(isFileOrFolderCommandBlocked).mockReturnValue(false);
    vi.mocked(hasLinkedNoteCandidate).mockReturnValue(true);
    vi.mocked(findLinkedNotesToMergeBack).mockResolvedValue(LINKED_NOTES);
  });

  it('should construct with correct params', () => {
    const { handler } = createHarness();
    expect(handler.id).toBe('merge-linked-notes-back');
    expect(handler.name).toBe('Merge linked notes back into this note...');
  });

  it('should be on the file menu but not on a link\'s context menu', () => {
    const { handler } = createHarness();
    expect(handler.shouldAddToFileMenu({ file: TARGET_FILE, source: 'file-explorer' })).toBe(true);
    expect(handler.shouldAddToFileMenu({ file: TARGET_FILE, source: 'link-context-menu' })).toBe(false);
  });

  it('should keep a submenu answer the registering menu surface forced off, and use the setting when it set none', async () => {
    const forcedOff = createHarness().handler;
    await registerCommandHandlerStub({ handler: forcedOff, shouldAddCommandToSubmenu: false });
    expect(forcedOff.shouldAddCommandToSubmenu()).toBe(false);

    const unset = createHarness().handler;
    await registerCommandHandlerStub({ handler: unset });
    expect(unset.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should be offered only on an unblocked note that links another note', () => {
    const { handler } = createHarness();
    expect(handler.canExecuteFile(TARGET_FILE)).toBe(true);
    vi.mocked(isMarkdownFile).mockReturnValueOnce(false);
    expect(handler.canExecuteFile(TARGET_FILE)).toBe(false);
    vi.mocked(isFileOrFolderCommandBlocked).mockReturnValueOnce(true);
    expect(handler.canExecuteFile(TARGET_FILE)).toBe(false);
    vi.mocked(hasLinkedNoteCandidate).mockReturnValueOnce(false);
    expect(handler.canExecuteFile(TARGET_FILE)).toBe(false);
  });

  it('should confirm, then merge every linked note at its link', async () => {
    const { editAndSave, handler, settings } = createHarness();
    await handler.executeFile(TARGET_FILE);

    expect(capturedConfirmParams).not.toBeNull();
    expect(editAndSave).toHaveBeenCalledOnce();
    expect(settings.shouldAskBeforeMerging).toBe(true);
    expect(mergeFilesIntoSingleFile).toHaveBeenCalledWith(expect.objectContaining({
      isNewTargetFile: false,
      shouldMergeAtSourceLinks: true,
      shouldRelocateOwnedAttachments: true,
      sourceFiles: [NOTE_A, NOTE_B],
      targetFile: TARGET_FILE
    }));
  });

  it('should stop asking once the dialog says not to ask again', async () => {
    confirmAnswer = { isConfirmed: true, shouldAskAgain: false };
    const { handler, settings } = createHarness();
    await handler.executeFile(TARGET_FILE);
    expect(settings.shouldAskBeforeMerging).toBe(false);
    expect(mergeFilesIntoSingleFile).toHaveBeenCalledOnce();
  });

  it('should merge nothing when the dialog is cancelled', async () => {
    confirmAnswer = { isConfirmed: false, shouldAskAgain: false };
    const { editAndSave, handler } = createHarness();
    await handler.executeFile(TARGET_FILE);
    expect(editAndSave).not.toHaveBeenCalled();
    expect(mergeFilesIntoSingleFile).not.toHaveBeenCalled();
  });

  it('should merge without a dialog when asking before merging is off', async () => {
    const { handler } = createHarness({ shouldAskBeforeMerging: false });
    await handler.executeFile(TARGET_FILE);
    expect(capturedConfirmParams).toBeNull();
    expect(mergeFilesIntoSingleFile).toHaveBeenCalledOnce();
  });

  it('should say so and merge nothing when no linked note qualifies', async () => {
    vi.mocked(findLinkedNotesToMergeBack).mockResolvedValueOnce([]);
    const { handler, showNotice } = createHarness();
    await handler.executeFile(TARGET_FILE);
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('target.md links no note on a line of its own'));
    expect(mergeFilesIntoSingleFile).not.toHaveBeenCalled();
  });

  it('should leave out the notes the path settings exclude, unless excluded items always merge', async () => {
    const { handler, settings } = createHarness();
    vi.mocked(settings.isPathIgnored).mockReturnValue(true);
    await handler.executeFile(TARGET_FILE);
    const { isIgnored } = vi.mocked(findLinkedNotesToMergeBack).mock.calls[0]?.[0] ?? { isIgnored: (): boolean => false };
    expect(isIgnored(NOTE_A)).toBe(true);
    expect(settings.isPathIgnored).toHaveBeenCalledWith('a.md', CommandCategory.Merge);

    const alwaysMerge = createHarness({ shouldAlwaysMergeExcludedItems: true });
    await alwaysMerge.handler.executeFile(TARGET_FILE);
    const second = vi.mocked(findLinkedNotesToMergeBack).mock.calls[1]?.[0] ?? { isIgnored: (): boolean => true };
    expect(second.isIgnored(NOTE_A)).toBe(false);
  });

  it('should list every note and the line of its link in the dialog', async () => {
    const fragment = createFragment();
    await buildMergeLinkedNotesConfirmContent({ app: strictProxy<App>({}), fragment, linkedNotes: LINKED_NOTES, targetFile: TARGET_FILE });
    expect(fragment.textContent).toBe('These 2 note(s) will each go in place of its link in target.md, and then be deleted:a.md (line 1)b.md (line 3)');
  });

  it('should render the dialog body through the captured builder', async () => {
    const { handler } = createHarness();
    await handler.executeFile(TARGET_FILE);
    const fragment = createFragment();
    await capturedConfirmParams?.buildContent(fragment);
    expect(fragment.textContent).toContain('a.md (line 1)');
  });
});
