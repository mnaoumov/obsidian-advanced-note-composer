import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
import type { MockInstance } from 'vitest';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import { EmptyFolderBehavior } from 'obsidian-dev-utils/obsidian/vault';
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

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

// The confirm dialog is the plugin's OWN sibling UI module: stub only its yes/no answer so the merge
// Proceeds without opening a modal. Everything else (vault, lock, transaction, composer, runner) is REAL.
import { confirmMergeFolderIntoFile } from '../modals/merge-folder-into-file-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { MergeFolderIntoFileCommandHandler } from './merge-folder-into-file-command-handler.ts';

interface HandlerContext {
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

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>(),
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('../modals/merge-folder-into-file-modal.ts', () => ({
  confirmMergeFolderIntoFile: vi.fn()
}));

const mockConfirm = vi.mocked(confirmMergeFolderIntoFile);

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new MergeFolderIntoFileCommandHandler({
    app,
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
        emptyFolderBehaviorAfterMergingFolder: EmptyFolderBehavior.Keep,
        isPathIgnored: () => false,
        markdownAttachmentSubExtensions: ['excalidraw'],
        mergeFolderIntoFileNoteNameTemplate: '',
        mergeTemplate: '{{content}}',
        shouldAddCommandsToSubmenu: true,
        shouldAlwaysMergeExcludedItems: false,
        shouldBlockCommandOnPath: () => false,
        shouldConvertFoldersToHeadingsWhenMergingFolder: false,
        shouldFixFootnotesByDefault: false,
        shouldMergeHeadingsByDefault: false,
        shouldMoveAttachmentsWhenMergingFolder: false,
        shouldOpenNoteAfterMerge: false,
        shouldRunTemplaterOnDestinationFile: false,
        shouldUseSourceTitleWhenTargetHasNoTitle: false,
        ...settingsOverrides
      })
    }),
    resourceLockComponent
  });
  return {
    handler: castTo<Testable>(handler),
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  // No `attachmentFolderPath` is set: the mocks default it to the vault root exactly as Obsidian does, and
  // That is where a merged note's attachments belong once the notes under the folder are gone.
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

function noticesContain(showNotice: MockInstance<PluginNoticeComponent['showNotice']>, text: string): boolean {
  return showNotice.mock.calls.some(([content]) => content instanceof DocumentFragment && content.textContent.includes(text));
}

describe('MergeFolderIntoFileCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp({});
    const { handler } = createHandler();
    expect(handler.id).toBe('merge-folder-into-file');
    expect(handler.name).toBe('Merge current folder contents into a single file...');
    expect(handler.icon).toBe('lucide-file-stack');
  });

  it('should refuse the vault root in canExecuteFolder', () => {
    initApp({ 'a.md': 'A' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
  });

  it('should allow a non-root folder in canExecuteFolder', async () => {
    initApp({});
    await app.vault.createFolder('some/folder');
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('some/folder'))).toBe(true);
  });

  it('should block a non-root folder when the command is blocked on its path', async () => {
    initApp({});
    await app.vault.createFolder('some/folder');
    const { handler } = createHandler({ shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteFolder(getFolder('some/folder'))).toBe(false);
  });

  it('should show a notice and not merge when the folder path is ignored', async () => {
    initApp({ 'src/note.md': 'note body' });
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path === 'src' });

    await handler.executeFolder(getFolder('src'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(await app.vault.adapter.read('src/note.md')).toBe('note body');
  });

  it('should show a notice when the folder has no markdown notes', async () => {
    initApp({ 'src/pic.png': 'PIC' });
    const { handler, showNotice } = createHandler();

    await handler.executeFolder(getFolder('src'));

    expect(noticesContain(showNotice, 'has no markdown notes to merge')).toBe(true);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('should merge all descendant notes into a single new file named after the folder', async () => {
    initApp({
      'src/a.md': 'alpha body',
      'src/sub/b.md': 'bravo body'
    });
    const { handler } = createHandler();
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // A new note named after the folder was created next to it, holding every descendant note's body.
    const merged = await app.vault.adapter.read('src.md');
    expect(merged).toContain('alpha body');
    expect(merged).toContain('bravo body');
    // The source notes were trashed.
    expect(await app.vault.adapter.exists('src/a.md')).toBe(false);
    expect(await app.vault.adapter.exists('src/sub/b.md')).toBe(false);
  });

  it('should merge notes in folder-grouped depth-first order, each level alphabetically', async () => {
    initApp({
      'src/alpha.md': 'alpha body',
      'src/sub/b.md': 'bravo body',
      'src/yankee/y.md': 'yankee body',
      'src/zeta.md': 'zeta body'
    });
    const { handler } = createHandler();
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // The folder's own notes come first (alphabetically), then each sub-folder's subtree
    // (alphabetically). A flat sort by path would put `src/sub/b.md` between `alpha` and `zeta`.
    const merged = await app.vault.adapter.read('src.md');
    const positions = ['alpha body', 'zeta body', 'bravo body', 'yankee body'].map((body) => merged.indexOf(body));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((position) => position >= 0)).toBe(true);
  });

  it('should turn sub-folders into headings and demote the merged notes when the setting is on', async () => {
    initApp({
      'src/api/get.md': '# Get\nget body',
      'src/api/v2/put.md': '# Put\nput body',
      'src/intro.md': '# Intro\nintro body'
    });
    const { handler } = createHandler({ shouldConvertFoldersToHeadingsWhenMergingFolder: true });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    const merged = await app.vault.adapter.read('src.md');
    // The root's own note keeps its heading level; each sub-folder is headed at its depth, and the notes
    // Inside are demoted by that depth so the outline nests instead of competing.
    expect(merged).toContain('# Intro');
    expect(merged).toContain('# api');
    expect(merged).toContain('## Get');
    expect(merged).toContain('## v2');
    expect(merged).toContain('### Put');
  });

  it('should not write folder headings when the setting is off', async () => {
    initApp({ 'src/api/get.md': '# Get\nget body' });
    const { handler } = createHandler();
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    const merged = await app.vault.adapter.read('src.md');
    expect(merged).not.toContain('# api');
    expect(merged).toContain('# Get');
  });

  it('should not write a folder heading for a folder whose notes are all ignored', async () => {
    initApp({
      'src/api/get.md': 'get body',
      'src/intro.md': 'intro body'
    });
    const { handler } = createHandler({
      isPathIgnored: (path) => path === 'src/api/get.md',
      shouldConvertFoldersToHeadingsWhenMergingFolder: true
    });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    const merged = await app.vault.adapter.read('src.md');
    expect(merged).toContain('intro body');
    expect(merged).not.toContain('# api');
  });

  it('should delete the folders the merge emptied', async () => {
    initApp({
      'src/api/v2/put.md': 'put body',
      'src/note.md': 'note body'
    });
    const { handler } = createHandler({ emptyFolderBehaviorAfterMergingFolder: EmptyFolderBehavior.Delete });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // Every note was merged away, so the whole tree is gone, deepest first.
    expect(app.vault.getFolderByPath('src/api/v2')).toBeNull();
    expect(app.vault.getFolderByPath('src/api')).toBeNull();
    expect(app.vault.getFolderByPath('src')).toBeNull();
    expect(await app.vault.adapter.read('src.md')).toContain('put body');
  });

  it('should keep a folder that still holds files', async () => {
    initApp({
      'src/api/img.png': 'PIC',
      'src/note.md': 'note body'
    });
    const { handler } = createHandler({ emptyFolderBehaviorAfterMergingFolder: EmptyFolderBehavior.Delete });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // The image is unreferenced and not at any note's attachment path, so it stays - and so must its
    // Folder, and therefore the merged folder above it.
    expect(app.vault.getFolderByPath('src/api')).not.toBeNull();
    expect(app.vault.getFolderByPath('src')).not.toBeNull();
  });

  it('should keep the folders when the behavior is Keep', async () => {
    initApp({ 'src/note.md': 'note body' });
    const { handler } = createHandler();
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    expect(app.vault.getFolderByPath('src')).not.toBeNull();
  });

  it('should not delete any folder when nothing was merged', async () => {
    initApp({ 'src/a.md': 'alpha body' });
    const { handler } = createHandler({
      emptyFolderBehaviorAfterMergingFolder: EmptyFolderBehavior.Delete,
      isPathIgnored: (path) => path === 'src/a.md'
    });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    expect(app.vault.getFolderByPath('src')).not.toBeNull();
    expect(await app.vault.adapter.read('src/a.md')).toBe('alpha body');
  });

  it('should not merge a markdown-shaped attachment into the target', async () => {
    initApp({
      'src/note.md': 'note body',
      'src/sketch.excalidraw.md': 'raw excalidraw payload'
    });
    const { handler } = createHandler();
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // The drawing's raw payload must never land in the merged note, and the drawing survives.
    const merged = await app.vault.adapter.read('src.md');
    expect(merged).toContain('note body');
    expect(merged).not.toContain('raw excalidraw payload');
    expect(await app.vault.adapter.exists('src/sketch.excalidraw.md')).toBe(true);
  });

  it('should treat every markdown file as a note when no sub-extension is configured', async () => {
    initApp({
      'src/note.md': 'note body',
      'src/sketch.excalidraw.md': 'raw excalidraw payload'
    });
    const { handler } = createHandler({ markdownAttachmentSubExtensions: [] });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    expect(await app.vault.adapter.read('src.md')).toContain('raw excalidraw payload');
  });

  it('should move the merged notes\' attachments into the target\'s attachment folder', async () => {
    initApp({
      'src/img.png': 'PIC',
      'src/note.md': '![[img.png]]'
    });
    const { handler } = createHandler({ shouldMoveAttachmentsWhenMergingFolder: true });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // The vault's attachment folder is the root, which is where the merged note's attachments belong.
    expect(await app.vault.adapter.exists('img.png')).toBe(true);
    expect(await app.vault.adapter.exists('src/img.png')).toBe(false);
  });

  it('should leave attachments alone when the setting is off', async () => {
    initApp({
      'src/img.png': 'PIC',
      'src/note.md': '![[img.png]]'
    });
    const { handler } = createHandler();
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    expect(await app.vault.adapter.exists('src/img.png')).toBe(true);
  });

  it('should leave an ignored note\'s attachments alone', async () => {
    initApp({
      'src/img.png': 'PIC',
      'src/keep.md': 'keep body',
      'src/note.md': '![[img.png]]'
    });
    const { handler } = createHandler({
      isPathIgnored: (path) => path === 'src/note.md',
      shouldMoveAttachmentsWhenMergingFolder: true
    });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // The only note referencing the image is skipped, so the image is not this merge's business.
    expect(await app.vault.adapter.exists('src/img.png')).toBe(true);
  });

  it('should name the merged note after the template when one is set', async () => {
    initApp({ 'src/a.md': 'alpha body' });
    const { handler } = createHandler({
      mergeFolderIntoFileNoteNameTemplate: '{{folderName}} summary',
      replacement: '_',
      shouldReplaceInvalidTitleCharacters: true
    });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // The note is still created beside the folder, but named by the template.
    expect(await app.vault.adapter.read('src summary.md')).toContain('alpha body');
    expect(await app.vault.adapter.exists('src.md')).toBe(false);
  });

  it('should sanitize the templated name and keep it in the folder\'s parent', async () => {
    initApp({ 'top/src/a.md': 'alpha body' });
    const { handler } = createHandler({
      mergeFolderIntoFileNoteNameTemplate: 'x/y*z.md',
      replacement: '_',
      shouldReplaceInvalidTitleCharacters: true
    });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('top/src'));

    // The trailing `.md` is trimmed, the separator collapses to one segment, and `*` is replaced.
    expect(await app.vault.adapter.read('top/x_y_z.md')).toContain('alpha body');
  });

  it('should fall back to the folder name when the template resolves to nothing', async () => {
    initApp({ 'src/a.md': 'alpha body' });
    const { handler } = createHandler({ mergeFolderIntoFileNoteNameTemplate: '   ' });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    expect(await app.vault.adapter.read('src.md')).toContain('alpha body');
  });

  it('should fall back to the folder name when the sanitized name still spans folders', async () => {
    initApp({ 'src/a.md': 'alpha body' });
    const { handler } = createHandler({
      mergeFolderIntoFileNoteNameTemplate: 'x/y',
      replacement: '_',
      shouldReplaceInvalidTitleCharacters: false
    });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // With invalid-character replacement off, the folded `\` survives, so the name is refused.
    expect(await app.vault.adapter.read('src.md')).toContain('alpha body');
  });

  it('should not create a target when the user cancels the confirmation', async () => {
    initApp({ 'src/a.md': 'alpha body' });
    const { handler } = createHandler();
    mockConfirm.mockResolvedValue(false);

    await handler.executeFolder(getFolder('src'));

    expect(await app.vault.adapter.exists('src.md')).toBe(false);
    expect(await app.vault.adapter.read('src/a.md')).toBe('alpha body');
  });

  it('should trash the empty target when every note is ignored', async () => {
    initApp({ 'src/a.md': 'alpha body' });
    const { handler } = createHandler({ isPathIgnored: (path) => path === 'src/a.md' });
    mockConfirm.mockResolvedValue(true);

    await handler.executeFolder(getFolder('src'));

    // Nothing merged, so the empty target was removed and the source stayed put.
    expect(await app.vault.adapter.exists('src.md')).toBe(false);
    expect(await app.vault.adapter.read('src/a.md')).toBe('alpha body');
  });

  it('should fall back to the submenu setting for shouldAddCommandToSubmenu', () => {
    initApp({});
    expect(createHandler({ shouldAddCommandsToSubmenu: true }).handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(createHandler({ shouldAddCommandsToSubmenu: false }).handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should always add the command to the folder menu', async () => {
    initApp({});
    await app.vault.createFolder('some/folder');
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu({ folder: getFolder('some/folder'), source: 'source' })).toBe(true);
  });
});
