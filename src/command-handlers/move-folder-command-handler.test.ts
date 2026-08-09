import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { MockInstance } from 'vitest';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  requestResourceUnlockForPath,
  ResourceLockComponent
} from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { InsertMode } from '../insert-mode.ts';
// The modal is the plugin's OWN sibling UI module: stub only its resolved target folder so the move
// Proceeds without opening a suggest modal. Everything else (vault, lock, transaction) is REAL.
import { selectTargetFolderForMove } from '../modals/move-folder-modal.ts';
import { openConfirmDialogModal } from '../open-minimizable-modal.ts';
import { MoveFolderCommandHandler } from './move-folder-command-handler.ts';

/**
 * The subset of the confirmation dialog's constructor params the tests drive: the body builder (so the
 * dialog content can be rendered without a real modal) and the resolve callback the mocked opener fires.
 */
interface CapturedConfirmParams {
  buildContent(this: void, fragment: DocumentFragment): Promise<void>;
  readonly canReselectTarget: boolean;
  promiseResolve(this: void, result: ConfirmDialogModalResult): void;
  readonly title: string;
}

interface HandlerContext {
  editAndSave: MockInstance<PluginSettingsComponent['editAndSave']>;
  handler: Testable;
  showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface Testable {
  canExecuteFolder(folder: TFolder): boolean;
  executeFolder(folder: TFolder): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((callback: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return callback(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

// A FRESH element per call: `appendChild` MOVES a node rather than copying it, so one shared span
// Would let a missing second link pass unnoticed.
vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockImplementation(() => Promise.resolve(createSpan()))
}));

// The confirmation dialog is v8-ignored modal UI; capture its params so the flow can be driven without
// One, and render its body directly to cover the content builder.
vi.mock('../modals/confirm-dialog-modal.ts', () => ({
  ConfirmDialogModal: class {
    public readonly params: CapturedConfirmParams;

    public constructor(params: CapturedConfirmParams) {
      this.params = params;
      capturedConfirmParams = params;
    }
  }
}));

vi.mock('../modals/move-folder-modal.ts', () => ({
  selectTargetFolderForMove: vi.fn()
}));

vi.mock('../open-minimizable-modal.ts', () => ({
  openConfirmDialogModal: vi.fn(() => {
    // The "Change target" loop can open the dialog more than once, so the results are a script; a round
    // The test did not script falls back to a plain cancel.
    capturedConfirmParams?.promiseResolve(confirmResults.shift() ?? createConfirmResult(false));
  })
}));

const mockOpenConfirmDialogModal = vi.mocked(openConfirmDialogModal);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockSelectTargetFolder = vi.mocked(selectTargetFolderForMove);

let app: AppOriginal;
let capturedConfirmParams: CapturedConfirmParams | null = null;
let confirmResults: ConfirmDialogModalResult[] = [];
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  capturedConfirmParams = null;
  confirmResults = [];
  // The module mocks are created once for the whole file, so their call history has to be dropped between
  // Tests; `restoreAllMocks` only undoes the per-test spies.
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function createConfirmResult(isConfirmed: boolean, shouldAskAgain = true, shouldReselectTarget = false): ConfirmDialogModalResult {
  return {
    insertMode: InsertMode.Append,
    isConfirmed,
    shouldAskAgain,
    shouldReselectTarget,
    shouldSwitchToSmartCut: false
  };
}

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const editAndSave = vi.fn().mockResolvedValue(undefined);
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new MoveFolderCommandHandler({
    app,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice, showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave,
      settings: strictProxy<PluginSettings>({
        isPathIgnored: () => false,
        shouldAddCommandsToSubmenu: true,
        shouldAskBeforeMovingFolder: false,
        shouldBlockCommandOnPath: () => false,
        shouldShowOperationNotices: true,
        ...settingsOverrides
      })
    }),
    resourceLockComponent
  });
  return {
    editAndSave: castTo<MockInstance<PluginSettingsComponent['editAndSave']>>(editAndSave),
    handler: castTo<Testable>(handler),
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string> = {}): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  vi.spyOn(app.vault, 'getAvailablePath').mockImplementation((basePath, extension) => {
    const suffix = extension ? `.${extension}` : '';
    let candidate = `${basePath}${suffix}`;
    let index = 0;
    while (app.vault.getAbstractFileByPath(candidate) !== null) {
      index += 1;
      candidate = `${basePath} ${index.toString()}${suffix}`;
    }
    return candidate;
  });
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

/**
 * Scripts the confirmation dialog's consecutive results, in the order the rounds of the "Change target"
 * loop will consume them.
 *
 * @param results - The results to return, in open order.
 */
function scriptConfirmResults(...results: ConfirmDialogModalResult[]): void {
  confirmResults = [...results];
}

describe('MoveFolderCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createHandler();
    expect(handler.id).toBe('move-folder');
    expect(handler.name).toBe('Move folder to...');
    expect(handler.icon).toBe('lucide-folder-input');
  });

  it('should refuse the vault root in canExecuteFolder', () => {
    initApp({ 'a/note.md': 'A' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
  });

  it('should allow a non-root folder in canExecuteFolder', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
  });

  it('should block a non-root folder in canExecuteFolder when the command is blocked on its path', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler({ shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
  });

  it('should show a notice and not move when the folder path is ignored', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path === 'parent/a' });

    await handler.executeFolder(getFolder('parent/a'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(mockSelectTargetFolder).not.toHaveBeenCalled();
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should do nothing when no target folder is selected', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(null);

    await handler.executeFolder(getFolder('parent/a'));

    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should move the folder into the chosen target, preserving its structure', async () => {
    initApp({
      'dst/keep.md': 'keep',
      'parent/a/note.md': 'note body',
      'parent/a/sub/deep.md': 'deep body'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('parent/a'));

    // The folder now lives under the target, keeping its internal structure.
    expect(await app.vault.adapter.read('dst/a/note.md')).toBe('note body');
    expect(await app.vault.adapter.read('dst/a/sub/deep.md')).toBe('deep body');
    // The source location is emptied out.
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
    // The pre-existing target file is untouched.
    expect(await app.vault.adapter.read('dst/keep.md')).toBe('keep');
  });

  it('should de-duplicate when the target already has a folder with the same name', async () => {
    initApp({
      'dst/a/existing.md': 'existing',
      'parent/a/note.md': 'note body'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('parent/a'));

    // The colliding target folder is preserved and the moved folder took an available (deduped) path.
    expect(await app.vault.adapter.read('dst/a/existing.md')).toBe('existing');
    expect(await app.vault.adapter.read('dst/a 1/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
  });

  it('should not move the folder when the confirmation is cancelled (issue #154)', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const { editAndSave, handler } = createHandler({ shouldAskBeforeMovingFolder: true });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));
    scriptConfirmResults(createConfirmResult(false));

    await handler.executeFolder(getFolder('parent/a'));

    expect(mockOpenConfirmDialogModal).toHaveBeenCalledTimes(1);
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('dst/a/note.md')).toBe(false);
    expect(editAndSave).not.toHaveBeenCalled();
  });

  it('should persist the "Don\'t ask again" choice and move once confirmed (issue #154)', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const { editAndSave, handler } = createHandler({ shouldAskBeforeMovingFolder: true });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));
    scriptConfirmResults(createConfirmResult(true, false));

    await handler.executeFolder(getFolder('parent/a'));

    expect(await app.vault.adapter.read('dst/a/note.md')).toBe('note body');
    const settings = strictProxy<PluginSettings>({ shouldAskBeforeMovingFolder: true });
    await editAndSave.mock.calls[0]?.[0](settings);
    expect(settings.shouldAskBeforeMovingFolder).toBe(false);
  });

  it('should reopen the picker when the confirmation asks to change the target', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    await app.vault.createFolder('dst2');
    const { handler } = createHandler({ shouldAskBeforeMovingFolder: true });
    mockSelectTargetFolder
      .mockResolvedValueOnce(getFolder('dst'))
      .mockResolvedValueOnce(getFolder('dst2'));
    // First round asks for a different target; the second confirms it.
    scriptConfirmResults(createConfirmResult(false, true, true), createConfirmResult(true));

    await handler.executeFolder(getFolder('parent/a'));

    expect(mockSelectTargetFolder).toHaveBeenCalledTimes(2);
    // The folder landed in the SECOND target, not the abandoned first one.
    expect(await app.vault.adapter.read('dst2/a/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('dst/a/note.md')).toBe(false);
  });

  it('should not open the confirmation at all when the setting is off', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const { handler } = createHandler({ shouldAskBeforeMovingFolder: false });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('parent/a'));

    expect(mockOpenConfirmDialogModal).not.toHaveBeenCalled();
    expect(await app.vault.adapter.read('dst/a/note.md')).toBe('note body');
  });

  it('should render the source and destination in the confirmation body', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const { handler } = createHandler({ shouldAskBeforeMovingFolder: true });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));
    scriptConfirmResults(createConfirmResult(false));

    await handler.executeFolder(getFolder('parent/a'));

    const fragment = createFragment();
    await capturedConfirmParams?.buildContent(fragment);

    const { appendCodeBlock } = await import('obsidian-dev-utils/obsidian/html-element');
    const renderedCodeBlocks = vi.mocked(appendCodeBlock).mock.calls.map((call) => call[1]);
    // Only the field LABELS are code blocks; both paths are links (issue #165).
    expect(renderedCodeBlocks).toContain('Source');
    expect(renderedCodeBlocks).toContain('Destination');
    expect(renderedCodeBlocks).not.toContain('dst');
    const renderedLinks = mockRenderInternalLink.mock.calls.map((call) => call[0].pathOrAbstractFile);
    expect(renderedLinks).toContain(getFolder('parent/a'));
    expect(renderedLinks).toContain(getFolder('dst'));
    // Unlike flatten, the move has a picked target, so it can be changed from the dialog.
    expect(capturedConfirmParams?.canReselectTarget).toBe(true);
    expect(capturedConfirmParams?.title).toBe('Move folder');
  });

  it('should label the vault root destination link with a slash', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler } = createHandler({ shouldAskBeforeMovingFolder: true });
    mockSelectTargetFolder.mockResolvedValue(app.vault.getRoot());
    scriptConfirmResults(createConfirmResult(false));

    await handler.executeFolder(getFolder('parent/a'));

    const fragment = createFragment();
    await capturedConfirmParams?.buildContent(fragment);

    // The root is labelled explicitly rather than by its raw path, matching the picker's `getItemText`.
    const renderedDisplayTexts = mockRenderInternalLink.mock.calls.map((call) => call[0].displayText);
    expect(renderedDisplayTexts).toContain('/');
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-move', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const source = getFolder('parent/a');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    const originalRenameFile = app.fileManager.renameFile.bind(app.fileManager);
    let hasAborted = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (file, newPath) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, source.path);
        throw new Error('Move cancelled.');
      }
      await originalRenameFile(file, newPath);
    });

    await expect(handler.executeFolder(source)).resolves.toBeUndefined();

    // Rolled back: the source note is intact and nothing landed under the target.
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('dst/a/note.md')).toBe(false);
  });

  it('should roll back and rethrow a non-abort error', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('boom'));

    await expect(handler.executeFolder(getFolder('parent/a'))).rejects.toThrow('boom');

    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should fall back to the submenu setting for shouldAddCommandToSubmenu', () => {
    initApp();
    expect(createHandler({ shouldAddCommandsToSubmenu: true }).handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(createHandler({ shouldAddCommandsToSubmenu: false }).handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should always add the command to the folder menu', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu({ folder: getFolder('parent/a'), source: 'source' })).toBe(true);
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
