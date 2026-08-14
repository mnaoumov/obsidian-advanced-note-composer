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
import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
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

import type { DidConfirmReorderModalParams } from '../modals/reorder-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { ReorderItemsCommandHandlerParams } from './reorder-items-command-handler-base.ts';

import { didConfirmReorderModal } from '../modals/reorder-modal.ts';
import { ReorderChildFoldersCommandHandler } from './reorder-child-folders-command-handler.ts';
import { ReorderSiblingFoldersCommandHandler } from './reorder-sibling-folders-command-handler.ts';

interface HandlerContext {
  handler: Testable;
  showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface Testable {
  canExecuteFolder(folder: TFolder): boolean;
  execute(): Promise<void>;
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

// A FRESH element per call: `appendChild` MOVES a node rather than copying it.
vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockImplementation(() => Promise.resolve(createSpan()))
}));

// The modal is v8-ignored UI; capture its params so the flow can be driven by moving rows on the REAL
// Model it was handed, which is what makes these tests exercise the model and the handler together.
vi.mock('../modals/reorder-modal.ts', () => ({
  didConfirmReorderModal: vi.fn().mockImplementation((params: DidConfirmReorderModalParams) => {
    driveModal?.(params);
    return Promise.resolve(isConfirmed);
  })
}));

const mockDidConfirmReorderModal = vi.mocked(didConfirmReorderModal);

let app: AppOriginal;
let driveModal: ((params: DidConfirmReorderModalParams) => void) | null = null;
let isConfirmed = true;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();

  driveModal = null;
  isConfirmed = true;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ReorderChildFoldersCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createChildHandler();
    expect(handler.id).toBe('reorder-child-folders');
    expect(handler.name).toBe('Reorder child folders...');
    expect(handler.icon).toBe('lucide-list-ordered');
  });

  it('should offer itself in the folder menu and follow the submenu setting', () => {
    initApp();
    const { handler } = createChildHandler();
    expect(handler.shouldAddToFolderMenu(castTo<FolderCommandHandlerShouldAddToFolderMenuParams>({}))).toBe(true);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should be unavailable with fewer than two child folders', () => {
    initApp({ 'parent/1. Alpha/note.md': 'a' });
    const { handler } = createChildHandler();
    expect(handler.canExecuteFolder(getFolder('parent'))).toBe(false);
  });

  it('should be available with two child folders', () => {
    initApp({
      'parent/1. Alpha/note.md': 'a',
      'parent/2. Beta/note.md': 'b'
    });
    const { handler } = createChildHandler();
    expect(handler.canExecuteFolder(getFolder('parent'))).toBe(true);
  });

  it('should be unavailable when the command is blocked on the path', () => {
    initApp({
      'parent/1. Alpha/note.md': 'a',
      'parent/2. Beta/note.md': 'b'
    });
    const { handler } = createChildHandler({ shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteFolder(getFolder('parent'))).toBe(false);
  });

  it('should refuse an ignored folder with a notice', async () => {
    initApp({
      'parent/1. Alpha/note.md': 'a',
      'parent/2. Beta/note.md': 'b'
    });
    const { handler, showNotice } = createChildHandler({ isPathIgnored: () => true });
    await handler.executeFolder(getFolder('parent'));
    expect(showNotice).toHaveBeenCalledOnce();
    expect(mockDidConfirmReorderModal).not.toHaveBeenCalled();
  });

  it('should renumber every child folder when one is moved', async () => {
    initApp({
      'parent/1. Alpha/note.md': 'a',
      'parent/2. Beta/note.md': 'b',
      'parent/3. Gamma/note.md': 'c'
    });
    const { handler } = createChildHandler();
    driveModal = (params): void => {
      moveRowDown(params, 'Alpha');
      moveRowDown(params, 'Alpha');
    };

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFolderNames('parent')).toEqual(['1. Beta', '2. Gamma', '3. Alpha']);
  });

  it('should number a folder that never carried an index', async () => {
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b'
    });
    const { handler } = createChildHandler();

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFolderNames('parent')).toEqual(['1. Alpha', '2. Beta']);
  });

  it('should do nothing at all when the order is left unchanged and already numbered', async () => {
    initApp({
      'parent/1. Alpha/note.md': 'a',
      'parent/2. Beta/note.md': 'b'
    });
    const { handler, showNotice } = createChildHandler();

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFolderNames('parent')).toEqual(['1. Alpha', '2. Beta']);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should leave everything alone when the modal is cancelled', async () => {
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b'
    });
    const { handler } = createChildHandler();
    isConfirmed = false;

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFolderNames('parent')).toEqual(['Alpha', 'Beta']);
  });

  it('should skip a child folder the plugin ignores, so a reorder never renames it', async () => {
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b',
      'parent/Ignored/note.md': 'i'
    });
    const { handler } = createChildHandler({ isPathIgnored: (path: string) => path === 'parent/Ignored' });

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFolderNames('parent')).toEqual(['1. Alpha', '2. Beta', 'Ignored']);
  });

  it('should rewrite the folder note title, and rename the note so it stays the folder note', async () => {
    initApp({
      'parent/1. Alpha/1. Alpha.md': '---\ntitle: 1. Alpha\naliases:\n  - Alpha\n---\n\nbody\n',
      'parent/2. Beta/2. Beta.md': '---\ntitle: 2. Beta\n---\n\nbody\n'
    });
    const { handler } = createChildHandler();
    driveModal = (params): void => {
      moveRowDown(params, 'Alpha');
    };

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFolderNames('parent')).toEqual(['1. Beta', '2. Alpha']);
    const alphaNote = await readNote('parent/2. Alpha/2. Alpha.md');
    expect(alphaNote).toContain('title: 2. Alpha');
    // The alias is the folder's name WITHOUT the index, and a reorder never touches it.
    expect(alphaNote).toContain('- Alpha');
    expect(alphaNote).toContain('body');
    expect(await readNote('parent/1. Beta/1. Beta.md')).toContain('title: 1. Beta');
  });

  it('should leave the title alone when its template is empty', async () => {
    initApp({ 'parent/1. Alpha/1. Alpha.md': '---\ntitle: 1. Alpha\n---\n\nbody\n', 'parent/2. Beta/2. Beta.md': '---\ntitle: 2. Beta\n---\n' });
    const { handler } = createChildHandler({ folderNoteTitleTemplate: '' });
    driveModal = (params): void => {
      moveRowDown(params, 'Alpha');
    };

    await handler.executeFolder(getFolder('parent'));

    expect(await readNote('parent/2. Alpha/2. Alpha.md')).toContain('title: 1. Alpha');
  });

  it('should write nothing when the vault has no folder notes', async () => {
    initApp({
      'parent/1. Alpha/1. Alpha.md': '---\ntitle: 1. Alpha\n---\n',
      'parent/2. Beta/2. Beta.md': '---\ntitle: 2. Beta\n---\n'
    });
    const { handler } = createChildHandler({ folderNoteLocation: FolderNoteLocation.None });
    driveModal = (params): void => {
      moveRowDown(params, 'Alpha');
    };

    await handler.executeFolder(getFolder('parent'));

    // Renamed with its folder, but its title is untouched: without folder notes there is nothing to write.
    expect(await readNote('parent/2. Alpha/1. Alpha.md')).toContain('title: 1. Alpha');
  });

  it('should renumber the files as their own sequence when they are included', async () => {
    initApp({
      'parent/1. Alpha/note.md': 'a',
      'parent/2. Beta/note.md': 'b',
      'parent/Draft.md': 'd',
      'parent/Notes.md': 'n'
    });
    const { handler } = createChildHandler({ shouldIncludeFilesWhenReorderingByDefault: true });

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFileNames('parent')).toEqual(['1. Draft.md', '2. Notes.md']);
    // The folders keep their own 1..N sequence — the two kinds never share one numbering.
    expect(getChildFolderNames('parent')).toEqual(['1. Alpha', '2. Beta']);
  });

  it('should leave the files alone when they are not included', async () => {
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b',
      'parent/Draft.md': 'd'
    });
    const { handler } = createChildHandler();

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFileNames('parent')).toEqual(['Draft.md']);
  });

  it('should write a file title when that template is filled in', async () => {
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b',
      'parent/Draft.md': '---\ntitle: Draft\n---\n'
    });
    const { handler } = createChildHandler({
      reorderedFileTitleTemplate: '{{name}}',
      shouldIncludeFilesWhenReorderingByDefault: true
    });

    await handler.executeFolder(getFolder('parent'));

    expect(await readNote('parent/1. Draft.md')).toContain('title: 1. Draft');
  });

  it('should add the files to the list when the modal\'s checkbox is ticked', async () => {
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b',
      'parent/Draft.md': 'd'
    });
    const { handler } = createChildHandler();
    driveModal = (params): void => {
      ensureNonNullable(params.toggle).onChanged(true);
    };

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFileNames('parent')).toEqual(['1. Draft.md']);
  });

  it('should offer the already-numbered items before the unnumbered ones, whichever order they come in', async () => {
    initApp({
      'parent/9. Beta/note.md': 'b',
      'parent/Alpha/note.md': 'a',
      'parent/Zulu/note.md': 'z'
    });
    const { handler } = createChildHandler();
    let rowLabels: string[] = [];
    driveModal = (params): void => {
      rowLabels = params.model.buildRows().map((row) => row.label);
    };

    await handler.executeFolder(getFolder('parent'));

    // The numbered one leads; the rest follow in natural name order.
    expect(rowLabels).toEqual(['Beta', 'Alpha', 'Zulu']);
    expect(getChildFolderNames('parent')).toEqual(['1. Beta', '2. Alpha', '3. Zulu']);
  });

  it('should leave a fixed-name folder note where it is, only retitling it', async () => {
    initApp({
      'parent/1. Alpha/!.md': '---\ntitle: 1. Alpha\n---\n',
      'parent/2. Beta/!.md': '---\ntitle: 2. Beta\n---\n'
    });
    const { handler } = createChildHandler({ folderNoteNameTemplate: '!' });
    driveModal = (params): void => {
      moveRowDown(params, 'Alpha');
    };

    await handler.executeFolder(getFolder('parent'));

    // `!` does not depend on the folder name, so the note moved with its folder and needed no rename.
    expect(await readNote('parent/2. Alpha/!.md')).toContain('title: 2. Alpha');
  });

  it('should sort every already-numbered folder ahead of the unnumbered ones, in either direction', async () => {
    // Deliberately interleaved, so the comparator meets a numbered/unnumbered pair BOTH ways round.
    initApp({
      'parent/1. Charlie/note.md': 'c',
      'parent/2. Beta/note.md': 'b',
      'parent/Alpha/note.md': 'a',
      'parent/Zulu/note.md': 'z'
    });
    const { handler } = createChildHandler();
    let rowLabels: string[] = [];
    driveModal = (params): void => {
      rowLabels = params.model.buildRows().map((row) => row.label);
    };

    await handler.executeFolder(getFolder('parent'));

    // Numbered first in their existing sequence, then the unnumbered by name.
    expect(rowLabels).toEqual(['Charlie', 'Beta', 'Alpha', 'Zulu']);
  });

  it('should lead with the numbered folder even when it sorts last in the vault, and renumber in the template\'s own shape', async () => {
    // With the index written as a SUFFIX, the numbered folder is the later child — the mirror image of
    // The prefix case above, and the only way the comparator meets the pair in this direction.
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta (1)/note.md': 'b'
    });
    const { handler } = createChildHandler({ reorderedFolderNameTemplate: '{{safeFolderName}} ({{index}})' });
    let rowLabels: string[] = [];
    driveModal = (params): void => {
      rowLabels = params.model.buildRows().map((row) => row.label);
    };

    await handler.executeFolder(getFolder('parent'));

    expect(rowLabels).toEqual(['Beta', 'Alpha']);
    expect(getChildFolderNames('parent')).toEqual(['Alpha (2)', 'Beta (1)']);
  });

  it('should rename a folder note that sits BESIDE its folder', async () => {
    initApp({
      'parent/Alpha.md': '---\ntitle: Alpha\n---\n',
      'parent/Alpha/inner.md': 'a',
      'parent/Beta/inner.md': 'b'
    });
    const { handler } = createChildHandler({ folderNoteLocation: FolderNoteLocation.ParentFolder });
    driveModal = (params): void => {
      moveRowDown(params, 'Alpha');
    };

    await handler.executeFolder(getFolder('parent'));

    // The note stays beside the folder and follows its new name.
    expect(await readNote('parent/2. Alpha.md')).toContain('title: 2. Alpha');
  });

  it('should break a cycle between two FILES', async () => {
    initApp({
      'parent/1. Notes.md': 'first',
      'parent/2. Notes.md': 'second',
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b'
    });
    const { handler } = createChildHandler({ shouldIncludeFilesWhenReorderingByDefault: true });
    driveModal = (params): void => {
      const row = params.model.buildRows().find((candidate) => candidate.groupKey === 'files');
      params.model.didMove({ delta: 1, id: ensureNonNullable(row).id });
    };

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFileNames('parent')).toEqual(['1. Notes.md', '2. Notes.md']);
    expect(await readNote('parent/2. Notes.md')).toBe('first');
    expect(await readNote('parent/1. Notes.md')).toBe('second');
  });

  it('should break a rename cycle rather than collide', async () => {
    initApp({
      'parent/1. Alpha/note.md': 'a',
      'parent/2. Alpha/note.md': 'b'
    });
    const { handler } = createChildHandler();
    driveModal = (params): void => {
      moveRowDown(params, 'Alpha');
    };

    await handler.executeFolder(getFolder('parent'));

    expect(getChildFolderNames('parent')).toEqual(['1. Alpha', '2. Alpha']);
    // The two swapped: what was `1. Alpha/note.md` now sits under `2. Alpha`.
    expect(await readNote('parent/2. Alpha/note.md')).toBe('a');
    expect(await readNote('parent/1. Alpha/note.md')).toBe('b');
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-reorder', async () => {
    initApp({
      'parent/Alpha/note.md': 'note body',
      'parent/Beta/note.md': 'b'
    });
    const parentFolder = getFolder('parent');
    const { handler } = createChildHandler();

    let hasAborted = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(() => {
      if (hasAborted) {
        return noopAsync();
      }

      hasAborted = true;
      // Unlocking mid-flight is what a user's Cancel does: it aborts the operation holding the lock.
      requestResourceUnlockForPath(app, parentFolder.path);
      return Promise.reject(new Error('Reorder cancelled.'));
    });

    await expect(handler.executeFolder(parentFolder)).resolves.toBeUndefined();

    // Rolled back: nothing was renumbered and the note is intact.
    expect(getChildFolderNames('parent')).toEqual(['Alpha', 'Beta']);
    expect(await app.vault.adapter.read('parent/Alpha/note.md')).toBe('note body');
  });

  it('should roll back and rethrow an error that is not a cancellation', async () => {
    initApp({
      'parent/Alpha/note.md': 'note body',
      'parent/Beta/note.md': 'b'
    });
    const { handler } = createChildHandler();
    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('Disk on fire.'));

    await expect(handler.executeFolder(getFolder('parent'))).rejects.toThrow('Disk on fire.');
    expect(getChildFolderNames('parent')).toEqual(['Alpha', 'Beta']);
  });

  it('should resolve the palette path through Obsidian\'s own new-note location', async () => {
    initApp({
      'parent/Alpha/note.md': 'a',
      'parent/Beta/note.md': 'b'
    });
    const { handler } = createChildHandler();
    vi.spyOn(app.fileManager, 'getNewFileParent').mockReturnValue(getFolder('parent'));

    await handler.execute();

    expect(getChildFolderNames('parent')).toEqual(['1. Alpha', '2. Beta']);
  });
});

describe('ReorderSiblingFoldersCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createSiblingHandler();
    expect(handler.id).toBe('reorder-sibling-folders');
    expect(handler.name).toBe('Reorder sibling folders...');
  });

  it('should reorder the clicked folder\'s own row, not its contents', async () => {
    initApp({
      'parent/Alpha/inner/note.md': 'a',
      'parent/Beta/note.md': 'b'
    });
    const { handler } = createSiblingHandler();

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(getChildFolderNames('parent')).toEqual(['1. Alpha', '2. Beta']);
    // Its own child is untouched: this command numbers the row the folder lives in.
    expect(getChildFolderNames('parent/1. Alpha')).toEqual(['inner']);
  });

  it('should offer the top-level folders when a root folder is clicked', async () => {
    initApp({
      'Alpha/note.md': 'a',
      'Beta/note.md': 'b'
    });
    const { handler } = createSiblingHandler();

    await handler.executeFolder(getFolder('Alpha'));

    // The empty name is an artifact of `obsidian-test-mocks` renaming at the vault ROOT — it materializes
    // A folder for the empty parent path. The real thing is covered by
    // `reorder-child-folders.desktop.integration.test.ts`, and the paths themselves are pinned by
    // `reorder-items.test.ts` ("should join onto the vault root without a leading slash").
    expect(getChildFolderNames('/').filter(Boolean)).toEqual(['1. Alpha', '2. Beta']);
  });

  it('should refuse the vault root, which has no siblings', async () => {
    initApp({ 'Alpha/note.md': 'a' });
    const { handler, showNotice } = createSiblingHandler();

    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
    await handler.executeFolder(app.vault.getRoot());
    expect(showNotice).toHaveBeenCalledOnce();
  });
});

function createChildHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new ReorderChildFoldersCommandHandler(createHandlerParams(castTo<PluginNoticeComponent['showNotice']>(showNotice), settingsOverrides));
  return toHandlerContext(handler, showNotice);
}

function createHandlerParams(showNotice: PluginNoticeComponent['showNotice'], settingsOverrides?: Partial<PluginSettings>): ReorderItemsCommandHandlerParams {
  return {
    app,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice, showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        folderNoteLocation: FolderNoteLocation.InsideFolder,
        folderNoteNameTemplate: '{{folderName}}',
        folderNoteTitleTemplate: '{{folderName}}',
        isPathIgnored: () => false,
        reorderedFileNameTemplate: '{{index}}. {{safeName}}',
        reorderedFileTitleTemplate: '',
        reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
        shouldAddCommandsToSubmenu: true,
        shouldBlockCommandOnPath: () => false,
        shouldIncludeFilesWhenReorderingByDefault: false,
        shouldShowOperationNotices: true,
        ...settingsOverrides
      })
    }),
    resourceLockComponent
  };
}

function createShowNoticeAfterDelayStub(): PluginNoticeComponent['showNoticeAfterDelay'] {
  return vi.fn().mockImplementation((delayedNoticeParams: PluginNoticeComponentShowNoticeAfterDelayParams) => {
    invokeAsyncSafely(async () => {
      await castTo<() => Promise<unknown>>(delayedNoticeParams.content)();
    });
    return { setContent: vi.fn(), [Symbol.dispose]: vi.fn() };
  });
}

function createSiblingHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new ReorderSiblingFoldersCommandHandler(createHandlerParams(castTo<PluginNoticeComponent['showNotice']>(showNotice), settingsOverrides));
  return toHandlerContext(handler, showNotice);
}

function getChildFileNames(path: string): string[] {
  return getFolder(path).children.filter((child) => 'extension' in child).map((child) => child.name).sort();
}

function getChildFolderNames(path: string): string[] {
  return getFolder(path).children.filter((child) => !('extension' in child)).map((child) => child.name).sort();
}

function getFolder(path: string): TFolder {
  return path === '/' ? app.vault.getRoot() : ensureNonNullable(app.vault.getFolderByPath(path));
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
 * Moves a row down one place on the REAL model the handler handed the modal — the same call the arrow
 * button makes.
 *
 * @param params - The captured modal params.
 * @param rowLabel - The row's label, which is its name without the index.
 */
function moveRowDown(params: DidConfirmReorderModalParams, rowLabel: string): void {
  const row = params.model.buildRows().find((candidate) => candidate.label === rowLabel);
  params.model.didMove({ delta: 1, id: ensureNonNullable(row).id });
}

async function readNote(path: string): Promise<string> {
  return await app.vault.read(ensureNonNullable(app.vault.getFileByPath(path)));
}

function toHandlerContext(handler: unknown, showNotice: unknown): HandlerContext {
  return {
    handler: castTo<Testable>(handler),
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}
