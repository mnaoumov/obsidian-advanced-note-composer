import type {
  App,
  TFolder
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from './confirm-dialog-modal.ts';

import { InsertMode } from '../insert-mode.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';
import { shouldMergeFolderIntoFile } from './merge-folder-into-file-modal.ts';

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('../open-minimizable-modal.ts', () => ({
  openMinimizableModal: vi.fn()
}));

// The modal itself is a `/* v8 ignore */` UI class; mock it as a bare constructor so the test can drive
// The dialog outcome (via the captured `promiseResolve`) without a real modal.
vi.mock('./confirm-dialog-modal.ts', () => ({
  ConfirmDialogModal: vi.fn()
}));

interface AskSettings {
  shouldAskBeforeMerging: boolean;
}

interface ConfirmArguments {
  readonly app: App;
  readonly noteCount: number;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
}

interface ConfirmModalArguments {
  buildContent(fragment: DocumentFragment): Promise<void>;
  promiseResolve(result: ConfirmDialogModalResult): void;
}

const mockAppendCodeBlock = vi.mocked(appendCodeBlock);
const mockConfirmDialogModal = vi.mocked(ConfirmDialogModal);
const mockRenderInternalLink = vi.mocked(renderInternalLink);

beforeEach(() => {
  vi.clearAllMocks();
});

function capturedModalParams(): ConfirmModalArguments {
  return castTo<ConfirmModalArguments>(mockConfirmDialogModal.mock.calls[0]?.[0]);
}

function createParams(shouldAskBeforeMerging: boolean, editAndSave = vi.fn().mockResolvedValue(undefined)): ConfirmArguments {
  return {
    app: strictProxy<App>({}),
    noteCount: 3,
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave,
      settings: strictProxy({ shouldAskBeforeMerging })
    }),
    sourceFolder: strictProxy<TFolder>({ path: 'src' })
  };
}

function makeResult(overrides: Partial<ConfirmDialogModalResult>): ConfirmDialogModalResult {
  return {
    insertMode: InsertMode.Append,
    isConfirmed: false,
    shouldAskAgain: true,
    shouldReselectTarget: false,
    shouldSwitchToSmartCut: false,
    ...overrides
  };
}

describe('shouldMergeFolderIntoFile', () => {
  it('confirms immediately without a dialog when shouldAskBeforeMerging is off', async () => {
    const params = createParams(false);
    const isResult = await shouldMergeFolderIntoFile({ ...params, targetPath: 'src.md' });
    expect(isResult).toBe(true);
    expect(mockConfirmDialogModal).not.toHaveBeenCalled();
  });

  it('returns true and persists the "don\'t ask again" choice when confirmed', async () => {
    const editAndSave = vi.fn((editor: (settings: AskSettings) => void) => {
      const settings: AskSettings = { shouldAskBeforeMerging: true };
      editor(settings);
      expect(settings.shouldAskBeforeMerging).toBe(false);
      return noopAsync();
    });
    const params = createParams(true, editAndSave);

    // The modal is constructed synchronously inside the awaited Promise; drive its outcome afterwards.
    const promise = shouldMergeFolderIntoFile({ ...params, targetPath: 'src.md' });
    expect(mockConfirmDialogModal).toHaveBeenCalledOnce();
    // Invoke buildContent so its wiring is exercised, then confirm.
    await capturedModalParams().buildContent(createFragment());
    capturedModalParams().promiseResolve(makeResult({ isConfirmed: true, shouldAskAgain: false }));

    expect(await promise).toBe(true);
    expect(editAndSave).toHaveBeenCalledOnce();
  });

  it('renders the not-yet-created target as a code block, never as a link (issue #166)', async () => {
    const params = createParams(true);

    const promise = shouldMergeFolderIntoFile({ ...params, targetPath: 'src.md' });
    await capturedModalParams().buildContent(createFragment());
    capturedModalParams().promiseResolve(makeResult({ isConfirmed: false }));
    await promise;

    // The folder exists, so it stays a link; the target note is created only after this dialog is confirmed,
    // So linking it would let a click create it.
    expect(mockRenderInternalLink).toHaveBeenCalledOnce();
    expect(mockRenderInternalLink).toHaveBeenCalledWith(expect.objectContaining({ pathOrAbstractFile: 'src' }));
    expect(mockAppendCodeBlock).toHaveBeenCalledWith(expect.anything(), 'src.md');
  });

  it('returns false when the dialog is cancelled', async () => {
    const params = createParams(true);

    const promise = shouldMergeFolderIntoFile({ ...params, targetPath: 'src.md' });
    capturedModalParams().promiseResolve(makeResult({ isConfirmed: false }));

    expect(await promise).toBe(false);
    expect(params.pluginSettingsComponent.editAndSave).not.toHaveBeenCalled();
  });
});
