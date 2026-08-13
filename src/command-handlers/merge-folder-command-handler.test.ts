import type {
  App as AppOriginal,
  TAbstractFile,
  TFolder,
  WorkspaceLeaf
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
import type { MockInstance } from 'vitest';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
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

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

// The modal is the plugin's OWN sibling UI module: stub only its resolved target folder so the merge
// Proceeds without opening a suggest modal. Everything else (vault, lock, transaction, composer) is REAL.
import { selectTargetFolderForMergeFolder } from '../modals/merge-folder-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { MergeFolderCommandHandler } from './merge-folder-command-handler.ts';

interface HandlerContext {
  handler: Testable;
  hide: MockInstance;
  showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface InitAppOptions {
  readonly plugins?: Record<string, unknown>;
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

// Return-value stubs for metadata-cache reads only: test-mocks has no metadata indexer, so getCacheSafe
// Would otherwise poll forever. Everything else stays REAL.
vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>(),
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

// UI-rendering helpers used only by notices — stub their return so link rendering does not reach into
// Unmocked App internals. Not the behavior under test.
vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((callback: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return callback(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('../modals/merge-folder-modal.ts', () => ({
  selectTargetFolderForMergeFolder: vi.fn()
}));

const mockSelectTargetFolder = vi.mocked(selectTargetFolderForMergeFolder);

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function containsNotice(showNotice: MockInstance<PluginNoticeComponent['showNotice']>, text: string): boolean {
  return showNotice.mock.calls.some(([content]) => content instanceof DocumentFragment && content.textContent.includes(text));
}

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const hide = vi.fn();
  const showNotice = vi.fn().mockReturnValue({ hide });
  const handler = new MergeFolderCommandHandler({
    app,
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice, showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        attachmentExtensions: ['.excalidraw.md'],
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
        isPathIgnored: () => false,
        mergeTemplate: '{{content}}',
        reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
        shouldAddCommandsToSubmenu: true,
        shouldAlwaysMergeExcludedItems: false,
        shouldBlockCommandOnPath: () => false,
        shouldFixFootnotesByDefault: false,
        shouldMergeHeadingsByDefault: false,
        shouldOpenFirstNoteAfterMergingFolder: false,
        shouldOpenNoteAfterMerge: false,
        shouldRunTemplaterOnDestinationFile: false,
        shouldShowOperationNotices: true,
        shouldUseSourceTitleWhenTargetHasNoTitle: false,
        ...settingsOverrides
      })
    }),
    resourceLockComponent
  });
  return {
    handler: castTo<Testable>(handler),
    hide,
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}

/**
 * Asserts that exactly one note was opened, and which one.
 *
 * The opened file is compared by PATH rather than handed to `toHaveBeenCalledWith`: a failing matcher would
 * pretty-format the mocked `TFile`, which probes properties the mock does not model and throws
 * `Property "$$typeof" is not mocked in TFile` — hiding the real mismatch behind an unrelated error.
 *
 * @param openFile - The `openFile` spy from {@link stubOpenFile}.
 * @param expectedPath - The path of the note that should have been opened.
 */
function expectOpened(openFile: MockInstance<WorkspaceLeaf['openFile']>, expectedPath: string): void {
  expect(openFile).toHaveBeenCalledOnce();
  expect(openFile.mock.lastCall?.[0].path).toBe(expectedPath);
  expect(openFile.mock.lastCall?.[1]).toEqual({ active: true });
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>, options: InitAppOptions = {}): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  // Test-mocks' MetadataCache has no indexer; the merge's processFrontMatter triggers a recompute.
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  if (options.plugins) {
    castTo<GenericObject>(app)['plugins'] = { plugins: options.plugins };
  }
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

describe('MergeFolderCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp({});
    const { handler } = createHandler();
    expect(handler.id).toBe('merge-folder');
    expect(handler.name).toBe('Merge current folder with another folder...');
    expect(handler.icon).toBe('merge');
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

  it('should block a non-root folder in canExecuteFolder when the command is blocked on its path', async () => {
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
    expect(mockSelectTargetFolder).not.toHaveBeenCalled();
    // The source is untouched.
    expect(await app.vault.adapter.read('src/note.md')).toBe('note body');
  });

  it('should skip an ignored markdown file without creating an empty target and report it (issue #72)', async () => {
    initApp({
      'src/sub/keep.md': 'keep body',
      'src/sub/secret.md': 'secret body'
    });
    await app.vault.createFolder('dst');
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path.endsWith('secret.md') });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // The non-ignored file merged into the target.
    expect(await app.vault.adapter.read('dst/sub/keep.md')).toContain('keep body');
    // The ignored file was NOT merged: no empty target file was created and the source is intact.
    expect(await app.vault.adapter.exists('dst/sub/secret.md')).toBe(false);
    expect(await app.vault.adapter.read('src/sub/secret.md')).toBe('secret body');
    // A summary notice reported the skipped file.
    expect(containsNotice(showNotice, 'were not merged because they are ignored')).toBe(true);
  });

  it('should move a markdown-shaped attachment instead of merging it (issue #161)', async () => {
    initApp({
      'src/sub/note.md': 'note body',
      'src/sub/sketch.excalidraw.md': 'DRAWING PAYLOAD'
    });
    await app.vault.createFolder('dst');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // The drawing arrived byte-identical: no merge template, no frontmatter merge, no heading.
    expect(await app.vault.adapter.read('dst/sub/sketch.excalidraw.md')).toBe('DRAWING PAYLOAD');
    expect(await app.vault.adapter.exists('src/sub/sketch.excalidraw.md')).toBe(false);
    // The ordinary note still merged.
    expect(await app.vault.adapter.read('dst/sub/note.md')).toContain('note body');
  });

  it('should de-duplicate a markdown-shaped attachment against one already in the target (issue #161)', async () => {
    // Merging the two would concatenate two raw payloads and corrupt the destination drawing.
    initApp({
      'dst/sub/sketch.excalidraw.md': 'TARGET PAYLOAD',
      'src/sub/sketch.excalidraw.md': 'SOURCE PAYLOAD'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    expect(await app.vault.adapter.read('dst/sub/sketch.excalidraw.md')).toBe('TARGET PAYLOAD');
    expect(await app.vault.adapter.read('dst/sub/sketch.excalidraw 1.md')).toBe('SOURCE PAYLOAD');
  });

  it('should merge a markdown-shaped attachment when no sub-extension is configured', async () => {
    initApp({ 'src/sub/sketch.excalidraw.md': 'DRAWING PAYLOAD' });
    await app.vault.createFolder('dst');
    const { handler } = createHandler({ attachmentExtensions: [] });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // The setting is what makes a markdown file an attachment; with it empty every `.md` is a note.
    expect(await app.vault.adapter.read('dst/sub/sketch.excalidraw.md')).toContain('DRAWING PAYLOAD');
  });

  it('should skip an ignored non-markdown file without moving it and report it (issue #72)', async () => {
    initApp({
      'src/sub/note.md': 'note body',
      'src/sub/pic.png': 'PIC'
    });
    await app.vault.createFolder('dst');
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path.endsWith('pic.png') });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // The markdown merged; the ignored picture stayed in place and was reported.
    expect(await app.vault.adapter.read('dst/sub/note.md')).toContain('note body');
    expect(await app.vault.adapter.exists('dst/sub/pic.png')).toBe(false);
    expect(await app.vault.adapter.exists('src/sub/pic.png')).toBe(true);
    expect(containsNotice(showNotice, 'were not merged because they are ignored')).toBe(true);
  });

  it('should merge excluded items instead of skipping them when shouldAlwaysMergeExcludedItems is on (issue #150)', async () => {
    initApp({
      'src/sub/keep.md': 'keep body',
      'src/sub/pic.png': 'PIC',
      'src/sub/secret.md': 'secret body'
    });
    await app.vault.createFolder('dst');
    const { handler, showNotice } = createHandler({
      isPathIgnored: (path) => path.endsWith('secret.md') || path.endsWith('pic.png'),
      shouldAlwaysMergeExcludedItems: true
    });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // The excluded markdown file was merged too (not skipped), and its source was trashed.
    expect(await app.vault.adapter.read('dst/sub/secret.md')).toContain('secret body');
    expect(await app.vault.adapter.exists('src/sub/secret.md')).toBe(false);
    // The excluded non-markdown file was moved too.
    expect(await app.vault.adapter.exists('dst/sub/pic.png')).toBe(true);
    expect(await app.vault.adapter.exists('src/sub/pic.png')).toBe(false);
    // The non-excluded file still merged, and no "ignored" notice was shown for the excluded ones.
    expect(await app.vault.adapter.read('dst/sub/keep.md')).toContain('keep body');
    expect(containsNotice(showNotice, 'were not merged because they are ignored')).toBe(false);
  });

  it('should do nothing when no target folder is selected', async () => {
    initApp({ 'src/note.md': 'note body' });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(null);

    await handler.executeFolder(getFolder('src'));

    // Nothing moved; the source note is intact.
    expect(await app.vault.adapter.read('src/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('src/sub')).toBe(false);
  });

  it('should merge markdown into the target, move other files, and trash emptied source subfolders', async () => {
    initApp({
      'dst/existing.md': 'existing body',
      'dst/sub/note.md': 'target note',
      'src/sub/fresh.md': 'fresh body',
      'src/sub/note.md': 'source note',
      'src/sub/pic.png': 'PIC'
    });
    await app.vault.createFolder('src/empty');
    const { handler, hide } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // Markdown merged into the pre-existing target file (isNewTargetFile === false path).
    const mergedNote = await app.vault.adapter.read('dst/sub/note.md');
    expect(mergedNote).toContain('target note');
    expect(mergedNote).toContain('source note');
    // Markdown merged into a freshly created target file (isNewTargetFile === true path).
    expect(await app.vault.adapter.read('dst/sub/fresh.md')).toContain('fresh body');
    // The non-markdown file was moved into the mapped target subfolder.
    expect(await app.vault.adapter.exists('dst/sub/pic.png')).toBe(true);
    expect(await app.vault.adapter.exists('src/sub/pic.png')).toBe(false);
    // The merged source notes were trashed.
    expect(await app.vault.adapter.exists('src/sub/note.md')).toBe(false);
    expect(await app.vault.adapter.exists('src/sub/fresh.md')).toBe(false);
    // The mapped subfolder was created and the emptied source subfolder trashed.
    expect(await app.vault.adapter.exists('dst/empty')).toBe(true);
    expect(await app.vault.adapter.exists('src/empty')).toBe(false);
    // The untouched target file is preserved.
    expect(await app.vault.adapter.read('dst/existing.md')).toBe('existing body');
    // The permanent progress notice was hidden on completion.
    expect(hide).toHaveBeenCalledOnce();
  });

  it('should keep a moved child note title when the target folder has no colliding note (issue #114)', async () => {
    initApp({ 'src/child/note.md': '---\ntitle: Child Title\n---\nchild body' });
    await app.vault.createFolder('dst');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // The child note lands in the mirrored target subfolder as a brand-new file (isNewTargetFile === true);
    // Its `title` frontmatter must survive the move rather than being dropped.
    const moved = await app.vault.adapter.read('dst/child/note.md');
    expect(moved).toContain('title: Child Title');
    expect(moved).toContain('child body');
    expect(await app.vault.adapter.exists('src/child/note.md')).toBe(false);
  });

  it('should not trash a source subfolder that still has children', async () => {
    initApp({
      'dst/keep.md': 'keep',
      'src/sub/note.md': 'source note'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    // Test-mocks does not prune the in-memory tree on adapter moves, so src/sub still "has children"
    // And is therefore not trashed.
    expect(await app.vault.adapter.exists('src/sub')).toBe(true);
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-merge', async () => {
    initApp({
      'src/sub/a.md': 'a body',
      'src/sub/b.md': 'b body'
    });
    await app.vault.createFolder('dst');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    // Simulate the user clicking the lock indicator's Unlock mid-operation: the first source read
    // Aborts the folder-lock's controller, so the next throwIfAborted rolls the spanning transaction back.
    const originalRead = app.vault.read.bind(app.vault);
    let hasAborted = false;
    vi.spyOn(app.vault, 'read').mockImplementation((file) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, 'src');
      }
      return originalRead(file);
    });

    await expect(handler.executeFolder(getFolder('src'))).resolves.toBeUndefined();

    // Rolled back: both source notes are intact and nothing was written into the target.
    expect(await app.vault.adapter.read('src/sub/a.md')).toBe('a body');
    expect(await app.vault.adapter.read('src/sub/b.md')).toBe('b body');
    expect(await app.vault.adapter.exists('dst/sub')).toBe(false);
  });

  it('should roll back and rethrow a non-abort error while still hiding the notice', async () => {
    initApp({ 'src/sub/a.md': 'a body' });
    await app.vault.createFolder('dst');
    const { handler, hide } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    vi.spyOn(app.vault, 'read').mockRejectedValue(new Error('boom'));

    await expect(handler.executeFolder(getFolder('src'))).rejects.toThrow('boom');

    // The spanning transaction rolled back: the source note is intact and no target subfolder remains.
    expect(await app.vault.adapter.read('src/sub/a.md')).toBe('a body');
    expect(await app.vault.adapter.exists('dst/sub')).toBe(false);
    expect(hide).toHaveBeenCalledOnce();
  });

  it('should warn when templater is enabled but the plugin is not installed', async () => {
    initApp({}, { plugins: {} });
    await app.vault.createFolder('src');
    await app.vault.createFolder('dst');
    const { handler, showNotice } = createHandler({ shouldRunTemplaterOnDestinationFile: true });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    expect(containsNotice(showNotice, 'Templater plugin is not installed')).toBe(true);
  });

  it('should not warn about templater when the plugin is installed', async () => {
    initApp({}, { plugins: { 'templater-obsidian': {} } });
    await app.vault.createFolder('src');
    await app.vault.createFolder('dst');
    const { handler, showNotice } = createHandler({ shouldRunTemplaterOnDestinationFile: true });
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('src'));

    expect(containsNotice(showNotice, 'Templater plugin is not installed')).toBe(false);
  });

  it('should sort markdown ascending by depth when the source is inside the target', async () => {
    initApp({
      'parent/child/a.md': 'a body',
      'parent/child/sub/b.md': 'b body'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('parent'));

    await handler.executeFolder(getFolder('parent/child'));

    // The nested note is merged into the mapped target subfolder.
    expect(await app.vault.adapter.read('parent/sub/b.md')).toContain('b body');
  });

  it('should sort markdown descending by depth when the target is inside the source', async () => {
    initApp({
      'src/a.md': 'a body',
      'src/deep/b.md': 'b body'
    });
    await app.vault.createFolder('src/dst');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('src/dst'));

    await expect(handler.executeFolder(getFolder('src'))).resolves.toBeUndefined();

    // The nested note is merged into the mapped target subfolder under the target.
    expect(await app.vault.adapter.read('src/dst/deep/b.md')).toContain('b body');
  });

  it('should not trash an empty source subfolder that is itself a mapped merge target', async () => {
    // With the target nested inside the source, one empty source subfolder (`s/y`) maps onto another
    // Empty source subfolder (`s/x/y`). The latter must survive because it is a destination of the merge.
    initApp({});
    await app.vault.createFolder('s');
    await app.vault.createFolder('s/x');
    await app.vault.createFolder('s/x/y');
    await app.vault.createFolder('s/y');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('s/x'));

    await handler.executeFolder(getFolder('s'));

    // `s/x/y` is a mapped target, so it is preserved; the plain empty `s/y` is trashed.
    expect(await app.vault.adapter.exists('s/x/y')).toBe(true);
    expect(await app.vault.adapter.exists('s/y')).toBe(false);
  });

  it('should ignore a child that is neither a file nor a folder', async () => {
    initApp({ 'dst/keep.md': 'keep' });
    await app.vault.createFolder('src');
    const sourceFolder = getFolder('src');
    // Inject a child that is neither TFile nor TFolder to exercise the defensive skip.
    sourceFolder.children.push(strictProxy<TAbstractFile>({ name: 'weird', path: 'src/weird' }));
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(sourceFolder);

    // The unknown child was ignored: the target is unchanged.
    expect(await app.vault.adapter.read('dst/keep.md')).toBe('keep');
  });

  // Issue #215. ONE open once the merge has landed — never the per-note open of issue #106, which stays
  // Suppressed whatever `Should open note after merge` says.
  describe('opening the first note of the destination folder (issue #215)', () => {
    it('should not open anything by default', async () => {
      initApp({ 'src/sub/a.md': 'a body' });
      await app.vault.createFolder('dst');
      const { handler } = createHandler();
      const getLeaf = vi.spyOn(app.workspace, 'getLeaf');
      mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

      await handler.executeFolder(getFolder('src'));

      expect(await app.vault.adapter.exists('dst/sub/a.md')).toBe(true);
      expect(getLeaf).not.toHaveBeenCalled();
    });

    // Naturally, not textually: `5.` before `30.` (issue #208's comparator), and a note that was already in
    // The destination competes on equal terms with the merged ones — what is asked for is the first note in
    // The folder, not the first note of the merge.
    it('should open the naturally-first note, counting notes that were already there', async () => {
      initApp({
        'dst/30. alpha.md': 'alpha body',
        'dst/5. beta.md': 'beta body',
        'src/sub/gamma.md': 'gamma body'
      });
      const { handler } = createHandler({ shouldOpenFirstNoteAfterMergingFolder: true });
      const openFile = stubOpenFile();
      mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

      await handler.executeFolder(getFolder('src'));

      expectOpened(openFile, 'dst/5. beta.md');
    });

    // Folder-grouped, like the file explorer: a note sitting in the folder itself beats one buried in a
    // Sub-folder, however the two paths would sort against each other.
    it('should prefer the folder\'s own note over one in a sub-folder', async () => {
      initApp({
        'dst/sub/aaa.md': 'aaa body',
        'dst/zzz.md': 'zzz body',
        'src/sub/mmm.md': 'mmm body'
      });
      const { handler } = createHandler({ shouldOpenFirstNoteAfterMergingFolder: true });
      const openFile = stubOpenFile();
      mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

      await handler.executeFolder(getFolder('src'));

      expectOpened(openFile, 'dst/zzz.md');
    });

    it('should descend into the first sub-folder when the destination itself holds no note', async () => {
      initApp({
        'dst/a-sub/first.md': 'first body',
        'dst/b-sub/second.md': 'second body',
        'src/sub/third.md': 'third body'
      });
      const { handler } = createHandler({ shouldOpenFirstNoteAfterMergingFolder: true });
      const openFile = stubOpenFile();
      mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

      await handler.executeFolder(getFolder('src'));

      expectOpened(openFile, 'dst/a-sub/first.md');
    });

    // A markdown-shaped attachment is not a note anywhere else in this handler, and it is not one here.
    it('should skip a markdown-shaped attachment', async () => {
      initApp({
        'dst/a.excalidraw.md': 'raw excalidraw payload',
        'dst/b.md': 'b body',
        'src/sub/c.md': 'c body'
      });
      const { handler } = createHandler({ shouldOpenFirstNoteAfterMergingFolder: true });
      const openFile = stubOpenFile();
      mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

      await handler.executeFolder(getFolder('src'));

      expectOpened(openFile, 'dst/b.md');
    });

    it('should open nothing when the destination ends up holding no note at all', async () => {
      initApp({
        'dst/pic.png': 'PIC',
        'src/sub/other.png': 'OTHER'
      });
      const { handler } = createHandler({ shouldOpenFirstNoteAfterMergingFolder: true });
      const getLeaf = vi.spyOn(app.workspace, 'getLeaf');
      mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

      await handler.executeFolder(getFolder('src'));

      expect(await app.vault.adapter.exists('dst/sub/other.png')).toBe(true);
      expect(getLeaf).not.toHaveBeenCalled();
    });

    it('should open nothing when the merge is cancelled mid-way', async () => {
      initApp({
        'src/sub/a.md': 'a body',
        'src/sub/b.md': 'b body'
      });
      await app.vault.createFolder('dst');
      const { handler } = createHandler({ shouldOpenFirstNoteAfterMergingFolder: true });
      const getLeaf = vi.spyOn(app.workspace, 'getLeaf');
      mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

      const originalRead = app.vault.read.bind(app.vault);
      let hasAborted = false;
      vi.spyOn(app.vault, 'read').mockImplementation((file) => {
        if (!hasAborted) {
          hasAborted = true;
          requestResourceUnlockForPath(app, 'src');
        }
        return originalRead(file);
      });

      await handler.executeFolder(getFolder('src'));

      expect(getLeaf).not.toHaveBeenCalled();
    });
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
 * Replaces the workspace's leaf with one whose `openFile` is a spy, so a test can see which note — if any —
 * the merge opened at the end (issue #215).
 *
 * @returns The `openFile` spy.
 */
function stubOpenFile(): MockInstance<WorkspaceLeaf['openFile']> {
  const openFile = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(strictProxy<WorkspaceLeaf>({ openFile }));
  return castTo<MockInstance<WorkspaceLeaf['openFile']>>(openFile);
}
