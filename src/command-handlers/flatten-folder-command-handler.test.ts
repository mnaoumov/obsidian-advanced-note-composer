import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { GetAvailablePathForAttachmentsExtendedFunctionParams } from 'obsidian-dev-utils/obsidian/attachment-path';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
import type { MockInstance } from 'vitest';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { getPath } from 'obsidian-dev-utils/obsidian/file-system';
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
import { openModal } from '../open-minimizable-modal.ts';
import { FlattenMode } from '../plugin-settings.ts';
import { FlattenFolderCommandHandler } from './flatten-folder-command-handler.ts';

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

/**
 * Settings overrides plus the mode, which is a CONSTRUCTOR parameter rather than a setting since each
 * flatten variant became its own command (issue #177).
 */
interface CreateHandlerOverrides extends Partial<PluginSettings> {
  flattenMode?: FlattenMode;
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

// UI-rendering helpers used only by notices — stub their return so link rendering does not reach into
// Unmocked App internals. Not the behavior under test.
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

vi.mock('../open-minimizable-modal.ts', () => ({
  openModal: vi.fn(() => {
    capturedConfirmParams?.promiseResolve(confirmResult);
  })
}));

const mockOpenModal = vi.mocked(openModal);
const mockRenderInternalLink = vi.mocked(renderInternalLink);

let app: AppOriginal;
let capturedConfirmParams: CapturedConfirmParams | null = null;
let confirmResult: ConfirmDialogModalResult = createConfirmResult(false);
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  capturedConfirmParams = null;
  confirmResult = createConfirmResult(false);
  // The module mocks are created once for the whole file, so their call history has to be dropped between
  // Tests; `restoreAllMocks` only undoes the per-test spies.
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function createConfirmResult(isConfirmed: boolean, shouldAskAgain = true): ConfirmDialogModalResult {
  return {
    insertMode: InsertMode.Append,
    isConfirmed,
    shouldAskAgain,
    shouldReselectTarget: false,
    shouldSwitchToSmartCut: false
  };
}

function createHandler(overrides?: CreateHandlerOverrides): HandlerContext {
  const { flattenMode = FlattenMode.AllChildren, ...settingsOverrides } = overrides ?? {};
  const editAndSave = vi.fn().mockResolvedValue(undefined);
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new FlattenFolderCommandHandler({
    app,
    flattenMode,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice, showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave,
      settings: strictProxy<PluginSettings>({
        attachmentExtensions: ['.excalidraw.md'],
        isPathIgnored: () => false,
        shouldAddCommandsToSubmenu: true,
        shouldAskBeforeFlattening: false,
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

function initApp(files: Record<string, string>, attachmentFolderPath = './'): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  app.vault.setConfig('attachmentFolderPath', attachmentFolderPath);
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

describe('FlattenFolderCommandHandler', () => {
  // Issue #177: one command per mode. The `AllChildren` id is deliberately the ORIGINAL `flatten-folder`,
  // Because a hotkey is bound to an id and hotkeys cannot be migrated — keeping the id on the default mode
  // Is the only thing that preserves any existing binding. Changing it would silently unbind users.
  it('should expose its command identity, keeping the original id for the default mode', () => {
    initApp({});
    const { handler } = createHandler();
    expect(handler.id).toBe('flatten-folder');
    expect(handler.name).toBe('Flatten folder...');
    expect(handler.icon).toBe('lucide-list-tree');
  });

  it('should give the child-folders-only mode its own command identity', () => {
    initApp({});
    const { handler } = createHandler({ flattenMode: FlattenMode.ChildFoldersOnly });
    expect(handler.id).toBe('flatten-folder-child-folders-only');
    expect(handler.name).toBe('Flatten folder (child folders only)...');
    expect(handler.icon).toBe('lucide-list-tree');
  });

  it('should give the recursive mode its own command identity', () => {
    initApp({});
    const { handler } = createHandler({ flattenMode: FlattenMode.AllFoldersRecursively });
    expect(handler.id).toBe('flatten-folder-all-folders-recursively');
    expect(handler.name).toBe('Flatten folder recursively (all folders at any depth)...');
    expect(handler.icon).toBe('lucide-list-tree');
  });

  it('should give every mode a distinct id, so none silently shadows another', () => {
    initApp({});
    const ids = [FlattenMode.AllChildren, FlattenMode.ChildFoldersOnly, FlattenMode.AllFoldersRecursively]
      .map((flattenMode) => createHandler({ flattenMode }).handler.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should refuse the vault root in canExecuteFolder', () => {
    initApp({ 'a/note.md': 'A' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
  });

  it('should refuse an empty folder in canExecuteFolder', async () => {
    initApp({});
    await app.vault.createFolder('empty');
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('empty'))).toBe(false);
  });

  it('should allow a non-empty non-root folder in canExecuteFolder', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
  });

  it('should block a non-empty non-root folder in canExecuteFolder when the command is blocked on its path', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler({ shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
  });

  it('should show a notice and not move anything when the folder path is ignored', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path === 'parent/a' });

    await handler.executeFolder(getFolder('parent/a'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should move direct children up to the parent, preserving subfolder structure', async () => {
    initApp({
      'parent/a/note.md': 'note body',
      'parent/a/pic.png': 'PIC',
      'parent/a/sub/deep.md': 'deep body'
    });
    const { handler } = createHandler();

    await handler.executeFolder(getFolder('parent/a'));

    // Direct children were promoted to the parent level.
    expect(await app.vault.adapter.read('parent/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('parent/pic.png')).toBe(true);
    // The subfolder was moved wholesale, keeping its internal structure.
    expect(await app.vault.adapter.read('parent/sub/deep.md')).toBe('deep body');
    // The children no longer live under the flattened folder.
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
    expect(await app.vault.adapter.exists('parent/a/sub/deep.md')).toBe(false);
  });

  it('should de-duplicate a name that collides with an existing sibling', async () => {
    initApp({
      'parent/a/note.md': 'inner body',
      'parent/note.md': 'existing body'
    });
    const { handler } = createHandler();

    await handler.executeFolder(getFolder('parent/a'));

    // The pre-existing sibling is untouched and the moved file landed on an available (deduped) path.
    expect(await app.vault.adapter.read('parent/note.md')).toBe('existing body');
    expect(await app.vault.adapter.read('parent/note 1.md')).toBe('inner body');
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
  });

  it('should de-duplicate each child against the names its siblings already took', async () => {
    // The same fixture `flatten-preview.test.ts` previews: the first rename takes `note 1.md`, so the
    // Second child is de-duplicated off its OWN name. Asserted here against the real renames, so the
    // Dialog's preview and the flatten cannot disagree.
    initApp({
      'parent/a/note.md': 'inner body',
      'parent/a/note 1.md': 'inner one body',
      'parent/note.md': 'existing body'
    });
    const { handler } = createHandler();

    await handler.executeFolder(getFolder('parent/a'));

    expect(await app.vault.adapter.read('parent/note.md')).toBe('existing body');
    expect(await app.vault.adapter.read('parent/note 1.md')).toBe('inner body');
    expect(await app.vault.adapter.read('parent/note 1 1.md')).toBe('inner one body');
  });

  it('should not move anything when the confirmation is cancelled (issue #154)', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { editAndSave, handler } = createHandler({ shouldAskBeforeFlattening: true });
    confirmResult = createConfirmResult(false);

    await handler.executeFolder(getFolder('parent/a'));

    expect(mockOpenModal).toHaveBeenCalledTimes(1);
    // Nothing was promoted and the "Don't ask again" choice was not persisted.
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('parent/note.md')).toBe(false);
    expect(editAndSave).not.toHaveBeenCalled();
  });

  it('should persist the "Don\'t ask again" choice and flatten once confirmed (issue #154)', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { editAndSave, handler } = createHandler({ shouldAskBeforeFlattening: true });
    confirmResult = createConfirmResult(true, false);

    await handler.executeFolder(getFolder('parent/a'));

    expect(await app.vault.adapter.read('parent/note.md')).toBe('note body');
    const settings = strictProxy<PluginSettings>({ shouldAskBeforeFlattening: true });
    await editAndSave.mock.calls[0]?.[0](settings);
    expect(settings.shouldAskBeforeFlattening).toBe(false);
  });

  it('should not open the confirmation at all when the setting is off', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler } = createHandler({ shouldAskBeforeFlattening: false });

    await handler.executeFolder(getFolder('parent/a'));

    expect(mockOpenModal).not.toHaveBeenCalled();
    expect(await app.vault.adapter.read('parent/note.md')).toBe('note body');
  });

  it('should list every item it will move in the confirmation body, flagging de-duplicated names', async () => {
    initApp({
      'parent/a/note.md': 'inner body',
      'parent/a/sub/deep.md': 'deep body',
      'parent/note.md': 'existing body'
    });
    const { handler } = createHandler({ shouldAskBeforeFlattening: true });
    confirmResult = createConfirmResult(false);

    await handler.executeFolder(getFolder('parent/a'));

    const fragment = createFragment();
    await capturedConfirmParams?.buildContent(fragment);

    const { appendCodeBlock } = await import('obsidian-dev-utils/obsidian/html-element');
    const renderedCodeBlocks = vi.mocked(appendCodeBlock).mock.calls.map((call) => call[1]);
    // The colliding note is previewed with the de-duplicated name it will actually get.
    expect(renderedCodeBlocks).toContain('note.md → note 1.md');
    // A non-colliding item is shown as-is, with no arrow.
    expect(renderedCodeBlocks).toContain('sub');
    expect(renderedCodeBlocks).toContain('2');
    // Both the folder and its destination are links, like every other confirmation dialog (issue #165).
    const renderedLinks = mockRenderInternalLink.mock.calls.map((call) => call[0].pathOrAbstractFile);
    expect(renderedLinks).toContain(getFolder('parent/a'));
    expect(renderedLinks).toContain(getFolder('parent'));
    expect(fragment.querySelector('h2')?.textContent).toBe('Items that will be moved');
    // There is no target to reselect: the destination is always the folder's own parent.
    expect(capturedConfirmParams?.canReselectTarget).toBe(false);
    expect(capturedConfirmParams?.title).toBe('Flatten folder');
  });

  it('should label the vault root destination link with a slash when flattening a top-level folder', async () => {
    initApp({ 'a/note.md': 'note body' });
    const { handler } = createHandler({ shouldAskBeforeFlattening: true });
    confirmResult = createConfirmResult(false);

    await handler.executeFolder(getFolder('a'));

    const fragment = createFragment();
    await capturedConfirmParams?.buildContent(fragment);

    // The root is labelled explicitly rather than by its raw path, matching the picker's `getItemText`.
    const renderedDisplayTexts = mockRenderInternalLink.mock.calls.map((call) => call[0].displayText);
    expect(renderedDisplayTexts).toContain('/');
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-flatten', async () => {
    initApp({
      'parent/a/a.md': 'a body',
      'parent/a/b.md': 'b body'
    });
    const { handler } = createHandler();

    // Simulate the user clicking the lock indicator's Unlock mid-operation: the first rename aborts the
    // Folder-lock's controller, so the next iteration's abort check rolls the transaction back.
    const originalRename = app.fileManager.renameFile.bind(app.fileManager);
    let hasAborted = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (file, newPath) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, 'parent/a');
      }
      await originalRename(file, newPath);
    });

    await expect(handler.executeFolder(getFolder('parent/a'))).resolves.toBeUndefined();

    // Rolled back: both notes are intact under the source folder and nothing was promoted.
    expect(await app.vault.adapter.read('parent/a/a.md')).toBe('a body');
    expect(await app.vault.adapter.read('parent/a/b.md')).toBe('b body');
  });

  it('should roll back and rethrow a non-abort error', async () => {
    initApp({ 'parent/a/a.md': 'a body' });
    const { handler } = createHandler();

    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('boom'));

    await expect(handler.executeFolder(getFolder('parent/a'))).rejects.toThrow('boom');

    // The transaction rolled back: the source note is intact.
    expect(await app.vault.adapter.read('parent/a/a.md')).toBe('a body');
  });

  describe('flatten modes (issues #170, #171)', () => {
    it('should refuse a folder with no child folder at all in a folder-only mode', () => {
      initApp({ 'parent/a/note.md': 'note' });
      expect(createHandler({ flattenMode: FlattenMode.ChildFoldersOnly }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
      expect(createHandler({ flattenMode: FlattenMode.AllFoldersRecursively }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
    });

    it('should allow a folder with a child folder in a folder-only mode', () => {
      initApp({ 'parent/a/sub/deep.md': 'deep' });
      expect(createHandler({ flattenMode: FlattenMode.ChildFoldersOnly }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
      expect(createHandler({ flattenMode: FlattenMode.AllFoldersRecursively }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
    });

    it('should refuse a folder whose only child folder is the attachment folder of a note staying behind (issue #185)', () => {
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      }, './attachments');
      // Nothing would move, so the command is not offered at all — instead of being offered and answering
      // With a notice.
      expect(createHandler({ flattenMode: FlattenMode.ChildFoldersOnly }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
      expect(createHandler({ flattenMode: FlattenMode.AllFoldersRecursively }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
    });

    it('should keep offering a folder-only mode when an attachment-location plugin owns the resolution (issue #185)', () => {
      initApp({
        'parent/a/note.md': 'note',
        'parent/a/note/pic.png': 'PIC'
      });
      stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));
      // The resolution is genuinely asynchronous now, so a synchronous menu pass cannot know the answer.
      // Behavior is unchanged there: the command is offered and `executeFolder` explains with a notice.
      expect(createHandler({ flattenMode: FlattenMode.ChildFoldersOnly }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
      expect(createHandler({ flattenMode: FlattenMode.AllFoldersRecursively }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
    });

    it('should keep offering AllChildren when the only child folder is the attachment folder', () => {
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      }, './attachments');
      // `AllChildren` promotes every direct child, attachment folder included, so it has plenty to do.
      expect(createHandler().handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
    });

    it('should promote only the child folders, leaving the folder\'s files and attachment folder behind (issue #170)', async () => {
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/note.md': 'note body',
        'parent/a/sub/deep.md': 'deep body'
      }, './attachments');
      const { handler } = createHandler({ flattenMode: FlattenMode.ChildFoldersOnly });

      await handler.executeFolder(getFolder('parent/a'));

      // The sub-folder was promoted, whole.
      expect(await app.vault.adapter.read('parent/sub/deep.md')).toBe('deep body');
      // The folder itself survives, with its own note and the attachment folder holding that note's files.
      expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
      expect(await app.vault.adapter.exists('parent/a/attachments/pic.png')).toBe(true);
      expect(await app.vault.adapter.exists('parent/attachments')).toBe(false);
    });

    it('should promote every descendant folder up to the folder\'s own level (issue #171)', async () => {
      initApp({
        'parent/a/b/c/deepest.md': 'deepest body',
        'parent/a/b/deep.md': 'deep body',
        'parent/a/note.md': 'note body'
      });
      const { handler } = createHandler({ flattenMode: FlattenMode.AllFoldersRecursively });

      await handler.executeFolder(getFolder('parent/a'));

      // Both folders became siblings of the flattened folder, each keeping its own files.
      expect(await app.vault.adapter.read('parent/b/deep.md')).toBe('deep body');
      expect(await app.vault.adapter.read('parent/c/deepest.md')).toBe('deepest body');
      expect(await app.vault.adapter.exists('parent/b/c')).toBe(false);
      // The flattened folder keeps its own note.
      expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
    });

    it('should show a notice and move nothing when the only child folder is the attachment folder an attachment-location plugin resolved', async () => {
      initApp({
        'parent/a/note.md': 'note body',
        'parent/a/note/pic.png': 'PIC'
      });
      stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));
      const { handler, showNotice } = createHandler({ flattenMode: FlattenMode.ChildFoldersOnly });

      // An attachment-location plugin owns the resolution, so `canExecuteFolder` cannot run it: it offers
      // The command, and this is where the user finds out nothing would move (issue #185).
      expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
      await handler.executeFolder(getFolder('parent/a'));

      expect(showNotice).toHaveBeenCalledOnce();
      expect(mockOpenModal).not.toHaveBeenCalled();
      expect(await app.vault.adapter.exists('parent/a/note/pic.png')).toBe(true);
    });

    it('should word the confirmation for the mode it is about to run', async () => {
      initApp({
        'parent/a/b/c/deepest.md': 'deepest',
        'parent/a/note.md': 'note'
      });
      confirmResult = createConfirmResult(false);

      const summaries: string[] = [];
      for (const flattenMode of [FlattenMode.AllChildren, FlattenMode.ChildFoldersOnly, FlattenMode.AllFoldersRecursively]) {
        const { handler } = createHandler({ flattenMode, shouldAskBeforeFlattening: true });
        await handler.executeFolder(getFolder('parent/a'));
        const fragment = createFragment();
        await capturedConfirmParams?.buildContent(fragment);
        summaries.push(fragment.textContent);
      }

      expect(summaries[0]).toContain('direct children move up one level and the emptied folder is left in place.');
      expect(summaries[1]).toContain('child folders move up one level. The folder itself is left in place');
      expect(summaries[2]).toContain('folders, from any depth under it, move up to become its siblings.');
    });

    it('should list a nested item by its path relative to the flattened folder', async () => {
      initApp({ 'parent/a/b/c/deepest.md': 'deepest' });
      const { handler } = createHandler({ flattenMode: FlattenMode.AllFoldersRecursively, shouldAskBeforeFlattening: true });
      confirmResult = createConfirmResult(false);

      await handler.executeFolder(getFolder('parent/a'));

      const fragment = createFragment();
      await capturedConfirmParams?.buildContent(fragment);

      const { appendCodeBlock } = await import('obsidian-dev-utils/obsidian/html-element');
      const renderedCodeBlocks = vi.mocked(appendCodeBlock).mock.calls.map((call) => call[1]);
      expect(renderedCodeBlocks).toContain('b');
      // `c` alone would be ambiguous the moment two promoted folders share a base name.
      expect(renderedCodeBlocks).toContain('b/c');
    });
  });

  /**
   * Issue #193: the reporter excluded their attachment folder and the flatten commands kept appearing. Both
   * new skips are synchronous, which is what lets `canExecuteFolder` answer even in the vault that prompted
   * the report — one running Custom Attachment Location, where the exact resolution cannot.
   */
  describe('excluded paths and the configured attachment folder (issue #193)', () => {
    it('should refuse every mode when the only child folder is excluded', () => {
      initApp({
        'parent/a/assets/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      });
      function isPathIgnored(path: string): boolean {
        return path.startsWith('parent/a/assets');
      }

      // `AllChildren` still has `note.md` to promote, so only the folder-only modes go quiet here.
      expect(createHandler({ flattenMode: FlattenMode.ChildFoldersOnly, isPathIgnored }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
      expect(createHandler({ flattenMode: FlattenMode.AllFoldersRecursively, isPathIgnored }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(
        false
      );
      expect(createHandler({ isPathIgnored }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
    });

    it('should refuse AllChildren when every direct child is excluded', () => {
      initApp({
        'parent/a/assets/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      });

      expect(createHandler({ isPathIgnored: (path: string) => path.startsWith('parent/a/') }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(
        false
      );
    });

    it('should refuse the folder-only modes when everything is excluded under an attachment-location plugin', () => {
      initApp({
        'parent/a/assets/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      });
      stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));

      function isPathIgnored(path: string): boolean {
        return path.startsWith('parent/a/assets');
      }

      // The reporter's exact vault. Without the exclusion these stay permissive (the test above at
      // "should keep offering a folder-only mode…"); with it, nothing could move and nothing is offered.
      expect(createHandler({ flattenMode: FlattenMode.ChildFoldersOnly, isPathIgnored }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
      expect(createHandler({ flattenMode: FlattenMode.AllFoldersRecursively, isPathIgnored }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(
        false
      );
    });

    it('should refuse the folder-only modes when the only child folder is the configured attachment folder, under an attachment-location plugin', () => {
      initApp({
        'parent/a/assets/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      }, './assets');
      stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));

      // No exclusion configured: Obsidian's own `attachmentFolderPath` is enough, and it is the only signal
      // Readable synchronously once the resolution is owned elsewhere.
      expect(createHandler({ flattenMode: FlattenMode.ChildFoldersOnly }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
      expect(createHandler({ flattenMode: FlattenMode.AllFoldersRecursively }).handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
    });

    it('should leave an excluded folder in place when flattening moves everything else', async () => {
      initApp({
        'parent/a/assets/pic.png': 'PIC',
        'parent/a/sub/deep.md': 'deep body'
      });
      const { handler } = createHandler({
        flattenMode: FlattenMode.ChildFoldersOnly,
        isPathIgnored: (path: string) => path.startsWith('parent/a/assets')
      });

      await handler.executeFolder(getFolder('parent/a'));

      expect(await app.vault.adapter.read('parent/sub/deep.md')).toBe('deep body');
      expect(await app.vault.adapter.exists('parent/a/assets/pic.png')).toBe(true);
      expect(await app.vault.adapter.exists('parent/assets')).toBe(false);
    });
  });

  it('should fall back to the submenu setting for shouldAddCommandToSubmenu', () => {
    initApp({});
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

/**
 * Models an attachment-location plugin (e.g. Custom Attachment Location): the `extended` member it installs
 * on Obsidian's `getAvailablePathForAttachments` is what `obsidian-dev-utils` dispatches to instead of the
 * native resolution.
 *
 * Its mere PRESENCE is what these tests are about — it makes the resolution asynchronous, so
 * `canExecuteFolder` cannot answer and stays permissive (issue #185).
 *
 * @param resolveAttachmentFolderPathForNote - Maps a note's path to the folder its attachments belong in.
 */
function stubAttachmentLocationPlugin(resolveAttachmentFolderPathForNote: (notePath: string) => string): void {
  function extended(params: GetAvailablePathForAttachmentsExtendedFunctionParams): Promise<string> {
    const notePath = getPath(app, ensureNonNullable(params.notePathOrFile));
    const folderPath = resolveAttachmentFolderPathForNote(notePath);
    return Promise.resolve(`${folderPath}/${params.attachmentFileBaseName}.${params.attachmentFileExtension}`);
  }

  app.vault.getAvailablePathForAttachments = castTo<typeof app.vault.getAvailablePathForAttachments>(Object.assign(vi.fn(), { extended }));
}
