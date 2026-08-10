import type {
  App as AppOriginal,
  MarkdownView as MarkdownViewOriginal,
  OpenViewState,
  TFile as TFileOriginal,
  WorkspaceLeaf as WorkspaceLeafOriginal
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
import type { MockInstance } from 'vitest';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  requestResourceUnlockForPath,
  ResourceLockComponent
} from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  App,
  MarkdownView,
  WorkspaceLeaf
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { mergeFilesIntoSingleFile } from './merge-into-single-file-runner.ts';
import { FrontmatterMergeStrategy } from './plugin-settings.ts';

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

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

interface InitAppOptions {
  readonly attachmentFolderPath?: string;
  readonly plugins?: Record<string, unknown>;
}

/**
 * A tab the rollback put back, as recorded by the stubbed leaf it was reopened in.
 */
interface ReopenedTab {
  isActive: boolean;
  path: string;
}

interface RunnerContext {
  hide: MockInstance;
  showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface RunnerHarness {
  consoleDebugComponent: ConsoleDebugComponent;
  context: RunnerContext;
  pluginNoticeComponent: PluginNoticeComponent;
  pluginSettingsComponent: PluginSettingsComponent;
}

function containsNotice(showNotice: MockInstance<PluginNoticeComponent['showNotice']>, text: string): boolean {
  return showNotice.mock.calls.some(([content]) => content instanceof DocumentFragment && content.textContent.includes(text));
}

function createContext(settingsOverrides?: Partial<PluginSettings>): RunnerHarness {
  const hide = vi.fn();
  const showNotice = vi.fn().mockReturnValue({ hide });
  const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice });
  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({
      attachmentExtensions: ['.excalidraw.md'],
      defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      isPathIgnored: () => false,
      mergeTemplate: '{{content}}',
      shouldAlwaysMergeExcludedItems: false,
      shouldFixFootnotesByDefault: false,
      shouldMergeHeadingsByDefault: false,
      shouldOpenNoteAfterMerge: false,
      shouldRunTemplaterOnDestinationFile: false,
      shouldShowOperationNotices: true,
      shouldUseSourceTitleWhenTargetHasNoTitle: false,
      ...settingsOverrides
    })
  });
  return {
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    context: { hide, showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice) },
    pluginNoticeComponent,
    pluginSettingsComponent
  };
}

function getFile(path: string): TFileOriginal {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

function initApp(files: Record<string, string>, options: InitAppOptions = {}): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  if (options.attachmentFolderPath !== undefined) {
    app.vault.setConfig('attachmentFolderPath', options.attachmentFolderPath);
  }
  if (options.plugins) {
    castTo<GenericObject>(app)['plugins'] = { plugins: options.plugins };
  }
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

function isLeafOpen(leaf: WorkspaceLeafOriginal): boolean {
  // By identity, and reported as a boolean: the leaves are `strictProxy`-wrapped, and a failed
  // `toContain` would have to format one, which probes properties the mock refuses to answer.
  let isOpen = false;
  app.workspace.iterateAllLeaves((openLeaf) => {
    isOpen ||= openLeaf === leaf;
  });
  return isOpen;
}

/**
 * Opens a note in a new tab the way the workspace really holds one — a leaf carrying a `MarkdownView` whose
 * `file` is the note. The mock's own `openFile` only records the file on the leaf and never builds a view,
 * which is precisely what the code under test looks at.
 *
 * @param path - The note to open.
 * @returns The leaf it was opened in.
 */
function openInTab(path: string): WorkspaceLeafOriginal {
  const leaf = app.workspace.getLeaf('tab');
  const view = MarkdownView.create2__(WorkspaceLeaf.fromOriginalType3__(leaf));
  castTo<GenericObject>(view)['file'] = app.vault.getFileByPath(path);
  castTo<GenericObject>(leaf)['view'] = view;
  return leaf;
}

describe('mergeFilesIntoSingleFile', () => {
  it('merges every source into a single new target, in order, and trashes the sources', async () => {
    initApp({
      'a.md': 'alpha body',
      'b.md': 'bravo body',
      'target.md': ''
    });
    const { consoleDebugComponent, context, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    const result = await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md'), getFile('b.md')],
      targetFile: getFile('target.md')
    });

    expect(result.aborted).toBe(false);
    expect(result.mergedCount).toBe(2);
    const merged = await app.vault.adapter.read('target.md');
    expect(merged).toContain('alpha body');
    expect(merged).toContain('bravo body');
    // The sources were trashed.
    expect(await app.vault.adapter.exists('a.md')).toBe(false);
    expect(await app.vault.adapter.exists('b.md')).toBe(false);
    // The permanent progress notice was hidden.
    expect(context.hide).toHaveBeenCalledOnce();
  });

  it('skips the target when it appears in the source list', async () => {
    initApp({
      'a.md': 'alpha body',
      'target.md': 'target body'
    });
    const { consoleDebugComponent, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    const result = await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: false,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md'), getFile('target.md')],
      targetFile: getFile('target.md')
    });

    expect(result.mergedCount).toBe(1);
    // The target survived (it was not merged into itself and not trashed).
    const merged = await app.vault.adapter.read('target.md');
    expect(merged).toContain('target body');
    expect(merged).toContain('alpha body');
  });

  it('skips an ignored source without merging it and reports it', async () => {
    initApp({
      'keep.md': 'keep body',
      'secret.md': 'secret body',
      'target.md': ''
    });
    const { consoleDebugComponent, context, pluginNoticeComponent, pluginSettingsComponent } = createContext({
      isPathIgnored: (path) => path === 'secret.md'
    });

    const result = await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('keep.md'), getFile('secret.md')],
      targetFile: getFile('target.md')
    });

    expect(result.mergedCount).toBe(1);
    expect(result.ignoredSourceFiles).toHaveLength(1);
    expect(await app.vault.adapter.read('target.md')).toContain('keep body');
    // The ignored source was left intact.
    expect(await app.vault.adapter.read('secret.md')).toBe('secret body');
    expect(containsNotice(context.showNotice, 'were not merged because they are ignored')).toBe(true);
  });

  it('merges an ignored source too when shouldAlwaysMergeExcludedItems is on', async () => {
    initApp({
      'secret.md': 'secret body',
      'target.md': ''
    });
    const { consoleDebugComponent, context, pluginNoticeComponent, pluginSettingsComponent } = createContext({
      isPathIgnored: (path) => path === 'secret.md',
      shouldAlwaysMergeExcludedItems: true
    });

    const result = await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('secret.md')],
      targetFile: getFile('target.md')
    });

    expect(result.mergedCount).toBe(1);
    expect(result.ignoredSourceFiles).toHaveLength(0);
    expect(await app.vault.adapter.read('target.md')).toContain('secret body');
    expect(await app.vault.adapter.exists('secret.md')).toBe(false);
    expect(containsNotice(context.showNotice, 'were not merged because they are ignored')).toBe(false);
  });

  it('moves each source note\'s own attachments into the target\'s attachment folder (issue #161)', async () => {
    // The note sorts after the image on purpose: the mock resolves a link when the note is created, so
    // The image has to exist first for the embed to resolve.
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/zeta.md': '![[img.png]]',
      'target.md': ''
    }, { attachmentFolderPath: './' });
    const { consoleDebugComponent, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      shouldRelocateOwnedAttachments: true,
      sourceFiles: [getFile('Docs/zeta.md')],
      targetFile: getFile('target.md')
    });

    // The target lives at the vault root, so the attachment of the note merged into it does too.
    expect(await app.vault.adapter.exists('img.png')).toBe(true);
    expect(await app.vault.adapter.exists('Docs/img.png')).toBe(false);
  });

  it('leaves attachments where they are when neither attachment rule is asked for', async () => {
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/zeta.md': '![[img.png]]',
      'target.md': ''
    }, { attachmentFolderPath: './' });
    const { consoleDebugComponent, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('Docs/zeta.md')],
      targetFile: getFile('target.md')
    });

    expect(await app.vault.adapter.exists('Docs/img.png')).toBe(true);
    expect(await app.vault.adapter.exists('img.png')).toBe(false);
  });

  it('rolls everything back and reports aborted when unlocked mid-merge', async () => {
    initApp({
      'a.md': 'alpha body',
      'b.md': 'bravo body',
      'target.md': ''
    });
    const { consoleDebugComponent, context, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    // Simulate the user clicking Unlock mid-operation: the first source read aborts the shared lock
    // Controller, so the next iteration's aborted-check rolls the spanning transaction back.
    const originalRead = app.vault.read.bind(app.vault);
    let hasAborted = false;
    vi.spyOn(app.vault, 'read').mockImplementation((file) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, 'a.md');
      }
      return originalRead(file);
    });

    const result = await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md'), getFile('b.md')],
      targetFile: getFile('target.md')
    });

    expect(result.aborted).toBe(true);
    expect(result.mergedCount).toBe(0);
    // Rolled back: both sources intact, target still empty.
    expect(await app.vault.adapter.read('a.md')).toBe('alpha body');
    expect(await app.vault.adapter.read('b.md')).toBe('bravo body');
    expect(await app.vault.adapter.read('target.md')).toBe('');
    expect(context.hide).toHaveBeenCalledOnce();
  });

  it('rolls back and rethrows a non-abort error while still hiding the notice', async () => {
    initApp({
      'a.md': 'alpha body',
      'target.md': ''
    });
    const { consoleDebugComponent, context, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    vi.spyOn(app.vault, 'read').mockRejectedValue(new Error('boom'));

    await expect(mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md')],
      targetFile: getFile('target.md')
    })).rejects.toThrow('boom');

    expect(await app.vault.adapter.read('a.md')).toBe('alpha body');
    expect(await app.vault.adapter.read('target.md')).toBe('');
    expect(context.hide).toHaveBeenCalledOnce();
  });

  it('warns when templater is enabled but the plugin is not installed', async () => {
    initApp({ 'a.md': 'alpha body', 'target.md': '' }, { plugins: {} });
    const { consoleDebugComponent, context, pluginNoticeComponent, pluginSettingsComponent } = createContext({
      shouldRunTemplaterOnDestinationFile: true
    });

    await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md')],
      targetFile: getFile('target.md')
    });

    expect(containsNotice(context.showNotice, 'Templater plugin is not installed')).toBe(true);
  });

  it('does not warn about templater when the plugin is installed', async () => {
    // eslint-disable-next-line camelcase -- Templater's real public API method name.
    initApp({ 'a.md': 'alpha body', 'target.md': '' }, { plugins: { 'templater-obsidian': { templater: { overwrite_file_commands: vi.fn() } } } });
    const { consoleDebugComponent, context, pluginNoticeComponent, pluginSettingsComponent } = createContext({
      shouldRunTemplaterOnDestinationFile: true
    });

    await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md')],
      targetFile: getFile('target.md')
    });

    expect(containsNotice(context.showNotice, 'Templater plugin is not installed')).toBe(false);
  });

  it('closes the tabs showing the notes it merges away and leaves every other tab alone (issue #212)', async () => {
    initApp({
      'a.md': 'alpha body',
      'b.md': 'bravo body',
      'keep.md': 'keep body',
      'target.md': ''
    });
    const { consoleDebugComponent, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    const alphaLeaf = openInTab('a.md');
    const bravoLeaf = openInTab('b.md');
    // A note that is not part of the merge, a tab showing no file, and a tab with no view at all: none of
    // Them is a note being merged away, so none of them may be touched.
    const keepLeaf = openInTab('keep.md');
    const fileLessLeaf = openInTab('gone.md');
    const viewLessLeaf = app.workspace.getLeaf('tab');

    await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md'), getFile('b.md')],
      targetFile: getFile('target.md')
    });

    expect(isLeafOpen(alphaLeaf)).toBe(false);
    expect(isLeafOpen(bravoLeaf)).toBe(false);
    expect(isLeafOpen(keepLeaf)).toBe(true);
    expect(isLeafOpen(fileLessLeaf)).toBe(true);
    expect(isLeafOpen(viewLessLeaf)).toBe(true);
  });

  it('puts the closed tabs back when the merge rolls back, the user\'s own one active (issue #212)', async () => {
    initApp({
      'a.md': 'alpha body',
      'b.md': 'bravo body',
      'target.md': ''
    });
    const { consoleDebugComponent, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    const alphaLeaf = openInTab('a.md');
    openInTab('b.md');
    // The user was in `a.md`, so that is the tab they are put back into.
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(castTo<MarkdownViewOriginal>(alphaLeaf.view));

    // Same mid-merge unlock as the rollback test above.
    const originalRead = app.vault.read.bind(app.vault);
    let hasAborted = false;
    vi.spyOn(app.vault, 'read').mockImplementation((file) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, 'a.md');
      }
      return originalRead(file);
    });

    // Installed only now: the tabs above were opened through the real `getLeaf`.
    const reopened: ReopenedTab[] = [];
    vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(castTo<WorkspaceLeafOriginal>({
      async openFile(file: TFileOriginal, openState?: OpenViewState): Promise<void> {
        reopened.push({ isActive: openState?.active ?? false, path: file.path });
        await noopAsync();
      }
    }));

    const result = await mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [getFile('a.md'), getFile('b.md')],
      targetFile: getFile('target.md')
    });

    expect(result.aborted).toBe(true);
    expect(reopened).toEqual([
      { isActive: true, path: 'a.md' },
      { isActive: false, path: 'b.md' }
    ]);
  });

  it('skips a tab whose note the rollback did not bring back (issue #212)', async () => {
    initApp({
      'a.md': 'alpha body',
      'target.md': ''
    });
    const { consoleDebugComponent, pluginNoticeComponent, pluginSettingsComponent } = createContext();

    openInTab('a.md');
    // Resolved before `getFileByPath` is stubbed out below.
    const alphaFile = getFile('a.md');
    const targetFile = getFile('target.md');

    vi.spyOn(app.vault, 'read').mockRejectedValue(new Error('boom'));

    const reopened: string[] = [];
    vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(castTo<WorkspaceLeafOriginal>({
      async openFile(file: TFileOriginal): Promise<void> {
        reopened.push(file.path);
        await noopAsync();
      }
    }));
    // The note is not there when the tabs are restored, so there is nothing to reopen it with.
    vi.spyOn(app.vault, 'getFileByPath').mockReturnValue(null);

    await expect(mergeFilesIntoSingleFile({
      app,
      consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent,
      pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent,
      sourceFiles: [alphaFile],
      targetFile
    })).rejects.toThrow('boom');

    expect(reopened).toEqual([]);
  });
});
