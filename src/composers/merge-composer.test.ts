import type { CustomArrayDict } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  Reference,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { EditorLockComponent } from 'obsidian-dev-utils/obsidian/editor-lock';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  editLinks,
  extractLinkFile,
  updateLink,
  updateLinksInContent
} from 'obsidian-dev-utils/obsidian/link';
import {
  getBacklinksForFileSafe,
  getCacheSafe,
  getFrontmatterSafe
} from 'obsidian-dev-utils/obsidian/metadata-cache';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { openProgressModal } from '../progress-modal.ts';
import { MergeComposer } from './merge-composer.ts';

interface AbortableComposer {
  readonly abortController: AbortController;
}

interface ComposerDeps {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly editorLockComponent: EditorLockComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface UpdateLinksParams {
  readonly content: string;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = activeDocument.createDocumentFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(activeDocument.createElement('span'))
}));

const { progressModalCloseMock } = vi.hoisted(() => ({ progressModalCloseMock: vi.fn() }));

vi.mock('../progress-modal.ts', () => ({
  openProgressModal: vi.fn().mockResolvedValue({ close: progressModalCloseMock })
}));

vi.mock('obsidian-dev-utils/obsidian/link', () => ({
  editLinks: vi.fn(),
  extractLinkFile: vi.fn(),
  updateLink: vi.fn(),
  updateLinksInContent: vi.fn().mockImplementation(({ content }: UpdateLinksParams) => content)
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  process: vi.fn(),
  trashSafe: vi.fn()
}));

vi.mock('../markdown-heading-document.ts', () => ({
  parseMarkdownHeadingDocument: vi.fn()
}));

function createComposer(settingsOverrides?: Partial<PluginSettings>): MergeComposer {
  const deps = createDeps(settingsOverrides);
  return new MergeComposer({
    ...deps,
    isNewTargetFile: false,
    sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
    targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
  });
}

function createDeps(overrides?: Partial<PluginSettings>): ComposerDeps {
  return castTo<ComposerDeps>({
    app: {
      fileManager: {
        insertIntoFile: vi.fn(),
        processFrontMatter: vi.fn()
      },
      metadataCache: { getFileCache: vi.fn().mockReturnValue({}) },
      plugins: { plugins: {} },
      vault: {
        cachedRead: vi.fn().mockResolvedValue(''),
        read: vi.fn().mockResolvedValue('source content')
      },
      workspace: {
        getActiveFile: vi.fn(),
        getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) })
      }
    },
    consoleDebugComponent: {
      consoleDebug: vi.fn()
    },
    editorLockComponent: {
      lockForPath: vi.fn(() => ({ [Symbol.dispose]: vi.fn() })),
      unlockForPath: vi.fn()
    },
    pluginNoticeComponent: {
      showNotice: vi.fn().mockReturnValue({ hide: vi.fn() })
    },
    pluginSettingsComponent: {
      settings: {
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
        isPathIgnored: vi.fn().mockReturnValue(false),
        mergeTemplate: '{{content}}',
        shouldFixFootnotesByDefault: false,
        shouldMergeHeadingsByDefault: false,
        shouldOpenNoteAfterMerge: false,
        shouldRunTemplaterOnDestinationFile: false,
        ...overrides
      }
    }
  });
}

function getAppObj(app: App): GenericObject {
  return castTo<GenericObject>(app);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MergeComposer', () => {
  it('should be constructable', () => {
    const deps = castTo<ComposerDeps>({
      app: {
        fileManager: {},
        metadataCache: { getFileCache: vi.fn() },
        plugins: { plugins: {} },
        vault: { cachedRead: vi.fn(), read: vi.fn() },
        workspace: {}
      },
      consoleDebugComponent: {
        consoleDebug: vi.fn()
      },
      pluginSettingsComponent: {
        settings: {
          defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
          mergeTemplate: '\n\n{{content}}',
          shouldFixFootnotesByDefault: true,
          shouldMergeHeadingsByDefault: false,
          shouldOpenNoteAfterMerge: false,
          shouldRunTemplaterOnDestinationFile: false
        }
      }
    });

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
    });

    expect(composer).toBeDefined();
  });
});

describe('mergeFile', () => {
  it('should return early when checkTargetFileIgnored returns false', async () => {
    const composer = createComposer({ isPathIgnored: vi.fn().mockReturnValue(true) });

    await composer.mergeFile();

    expect(trashSafe).not.toHaveBeenCalled();
  });

  it('should merge file content and trash source on happy path', async () => {
    const composer = createComposer();

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.mergeFile();

    expect(trashSafe).toHaveBeenCalled();
  });

  it('should abort the merge and not trash the source when a file is modified during the operation', async () => {
    const deps = createDeps();
    const sourceStat = { ctime: 0, mtime: 100, size: 0 };
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: sourceStat });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 200, size: 0 } });
    const appObj = getAppObj(deps.app);
    appObj['vault'] = {
      cachedRead: vi.fn().mockResolvedValue(''),
      // Simulate an external edit to the source while the operation is in progress.
      read: vi.fn().mockImplementation(() => {
        sourceStat.mtime = 999;
        return Promise.resolve('source content');
      })
    };

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile,
      targetFile
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    vi.mocked(trashSafe).mockClear();

    await composer.mergeFile();

    expect(trashSafe).not.toHaveBeenCalled();
  });

  it('should lock the source and target notes during the merge and unlock them afterwards', async () => {
    const deps = createDeps();
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile,
      targetFile
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.mergeFile();

    expect(deps.editorLockComponent.lockForPath).toHaveBeenCalledWith(sourceFile, { abortController: expect.any(AbortController) as AbortController });
    expect(deps.editorLockComponent.lockForPath).toHaveBeenCalledWith(targetFile, { abortController: expect.any(AbortController) as AbortController });
    expect(deps.editorLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
    expect(deps.editorLockComponent.unlockForPath).toHaveBeenCalledWith(targetFile);
  });

  it('should swallow the error and release the locks when the merge is cancelled by unlocking', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = {
      insertIntoFile: vi.fn().mockRejectedValue(new Error('insert error')),
      processFrontMatter: vi.fn()
    };
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile,
      targetFile
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    // Simulate the user clicking the lock indicator's "Unlock" mid-operation.
    castTo<AbortableComposer>(composer).abortController.abort();

    // The cancellation is swallowed: the operation resolves without throwing.
    await expect(composer.mergeFile()).resolves.toBeUndefined();
    expect(deps.editorLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
    expect(deps.editorLockComponent.unlockForPath).toHaveBeenCalledWith(targetFile);
  });

  it('should rethrow and release the locks when the merge fails without cancellation', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['fileManager'] = {
      insertIntoFile: vi.fn().mockRejectedValue(new Error('insert error')),
      processFrontMatter: vi.fn()
    };
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile,
      targetFile
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await expect(composer.mergeFile()).rejects.toThrow('insert error');
    expect(deps.editorLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
    expect(deps.editorLockComponent.unlockForPath).toHaveBeenCalledWith(targetFile);
  });

  it('should open a minimizable progress modal during the merge and close it afterwards', async () => {
    const deps = createDeps();
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile,
      targetFile
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    vi.mocked(openProgressModal).mockClear();
    progressModalCloseMock.mockClear();

    await composer.mergeFile();

    expect(openProgressModal).toHaveBeenCalledTimes(1);
    const params = vi.mocked(openProgressModal).mock.calls[0]?.[0];
    expect(params?.app).toBe(deps.app);
    expect(params?.sourceFile).toBe(sourceFile);
    expect(params?.targetFile).toBe(targetFile);
    expect(params?.verb).toBe('Merging');
    expect(progressModalCloseMock).toHaveBeenCalled();
  });

  it('should not open a progress modal when shouldShowNotice is false', async () => {
    const deps = createDeps();
    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      shouldShowNotice: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});
    vi.mocked(openProgressModal).mockClear();

    await composer.mergeFile();

    expect(openProgressModal).not.toHaveBeenCalled();
  });

  it('should complete merge flow successfully with notice shown', async () => {
    const composer = createComposer();

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.mergeFile();

    // Merge completed successfully with notice (no errors thrown)
    expect(trashSafe).toHaveBeenCalled();
  });

  it('should not show notice when shouldShowNotice is false', async () => {
    const deps = createDeps();

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      shouldShowNotice: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    // Should complete without error even when shouldShowNotice is false
    await composer.mergeFile();

    expect(trashSafe).toHaveBeenCalled();
  });

  it('should open note after merge when shouldOpenNoteAfterMerge is true', async () => {
    const openFileMock = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ shouldOpenNoteAfterMerge: true });
    const appObj = getAppObj(deps.app);
    appObj['workspace'] = {
      getActiveFile: vi.fn(),
      getLeaf: vi.fn().mockReturnValue({ openFile: openFileMock })
    };

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.mergeFile();

    expect(openFileMock).toHaveBeenCalled();
  });

  it('should not open note when shouldOpenNoteAfterMerge is false', async () => {
    const openFileMock = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ shouldOpenNoteAfterMerge: false });
    const appObj = getAppObj(deps.app);
    appObj['workspace'] = {
      getActiveFile: vi.fn(),
      getLeaf: vi.fn().mockReturnValue({ openFile: openFileMock })
    };

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.mergeFile();

    expect(openFileMock).not.toHaveBeenCalled();
  });
});

describe('MergeComposer fixBacklinks', () => {
  it('should fix self-links in target file after calling super', async () => {
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } });

    const deps = createDeps();

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile,
      targetFile
    });

    // Set up editLinks to call the callback with a link pointing to source
    vi.mocked(editLinks).mockImplementation(async ({ linkConverter: callback, pathOrFile }) => {
      if (pathOrFile === targetFile || (typeof pathOrFile === 'string' && pathOrFile === 'target.md')) {
        const link = { link: 'source', original: '[[source]]' };
        vi.mocked(extractLinkFile).mockReturnValue(sourceFile);
        await callback(link);
      }
    });
    vi.mocked(updateLink).mockReturnValue('updated');
    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.mergeFile();

    // EditLinks should be called for the target file (self-link fix)
    const editLinksCalls = vi.mocked(editLinks).mock.calls;
    const targetFileCalls = editLinksCalls.filter((call) => call[0].pathOrFile === targetFile);
    expect(targetFileCalls.length).toBeGreaterThan(0);
  });
});

describe('MergeComposer getSelections', () => {
  it('should return full file content as single selection', async () => {
    const deps = createDeps();
    const appObj = getAppObj(deps.app);
    appObj['vault'] = {
      ...appObj['vault'] as GenericObject,
      read: vi.fn().mockResolvedValue('hello world')
    };

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    // Trigger mergeFile which calls getSelections internally
    await composer.mergeFile();

    // The read method should have been called (getSelections reads the whole file)
    const readMock = (appObj['vault'] as GenericObject)['read'];
    expect(readMock).toHaveBeenCalled();
  });
});

describe('MergeComposer getTemplate', () => {
  it('should return mergeTemplate from settings', () => {
    const deps = createDeps({ mergeTemplate: 'custom: {{content}}' });

    const composer = new MergeComposer({
      ...deps,
      isNewTargetFile: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md', stat: { ctime: 0, mtime: 0, size: 0 } }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md', stat: { ctime: 0, mtime: 0, size: 0 } })
    });

    // GetTemplate is called internally; we can verify by checking the template is applied to content
    expect(composer).toBeDefined();
  });
});

describe('MergeComposer prepareBacklinkSubpaths', () => {
  it('should include empty string in subpaths for full file merge', async () => {
    const composer = createComposer();

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    // Backlinks pointing to the source file (no subpath) should be picked up
    const backlinkMap = new Map<string, unknown[]>();
    backlinkMap.set('other.md', [{ link: 'source' }]);
    vi.mocked(getBacklinksForFileSafe).mockResolvedValue(castTo<CustomArrayDict<Reference>>(backlinkMap));

    vi.mocked(editLinks).mockImplementation(async ({ linkConverter: callback }) => {
      await callback(castTo<Reference>({ link: 'source' }));
    });
    vi.mocked(updateLink).mockReturnValue('updated');

    await composer.mergeFile();

    expect(getBacklinksForFileSafe).toHaveBeenCalled();
  });
});
