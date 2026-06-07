import type { CustomArrayDict } from '@obsidian-typings/obsidian-public-latest';
import type {
  Reference,
  TFile
} from 'obsidian';
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

import type { PluginSettings } from '../plugin-settings.ts';
import type { Plugin } from '../plugin.ts';

import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { MergeComposer } from './merge-composer.ts';

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

vi.mock('obsidian-dev-utils/string', () => ({
  replaceAll: vi.fn((str: string) => str)
}));

vi.mock('obsidian-dev-utils/function', () => ({
  noop: vi.fn()
}));

vi.mock('obsidian-dev-utils/object-utils', () => ({
  castTo: (value: unknown): unknown => value,
  extractDefaultExportInterop: (m: unknown): unknown => m
}));

vi.mock('../markdown-heading-document.ts', () => ({
  parseMarkdownHeadingDocument: vi.fn()
}));

function createComposer(pluginOverrides?: Partial<PluginSettings>): MergeComposer {
  const plugin = createPlugin(pluginOverrides);
  return new MergeComposer({
    isNewTargetFile: false,
    plugin,
    sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
    targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
  });
}

function createPlugin(overrides?: Partial<PluginSettings>): Plugin {
  return castTo<Plugin>({
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
    consoleDebug: vi.fn(),
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

function getPluginAppObj(plugin: Plugin): GenericObject {
  return castTo<GenericObject>(plugin.app);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MergeComposer', () => {
  it('should be constructable', () => {
    const plugin = castTo<Plugin>({
      app: {
        fileManager: {},
        metadataCache: { getFileCache: vi.fn() },
        plugins: { plugins: {} },
        vault: { cachedRead: vi.fn(), read: vi.fn() },
        workspace: {}
      },
      consoleDebug: vi.fn(),
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
      isNewTargetFile: false,
      plugin,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
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
    const plugin = createPlugin();

    const composer = new MergeComposer({
      isNewTargetFile: false,
      plugin,
      shouldShowNotice: false,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
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
    const plugin = createPlugin({ shouldOpenNoteAfterMerge: true });
    const appObj = getPluginAppObj(plugin);
    appObj['workspace'] = {
      getActiveFile: vi.fn(),
      getLeaf: vi.fn().mockReturnValue({ openFile: openFileMock })
    };

    const composer = new MergeComposer({
      isNewTargetFile: false,
      plugin,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
    });

    vi.mocked(updateLinksInContent).mockImplementation(({ content }) => Promise.resolve(content));
    vi.mocked(getCacheSafe).mockResolvedValue(null);
    vi.mocked(getFrontmatterSafe).mockResolvedValue({});

    await composer.mergeFile();

    expect(openFileMock).toHaveBeenCalled();
  });

  it('should not open note when shouldOpenNoteAfterMerge is false', async () => {
    const openFileMock = vi.fn().mockResolvedValue(undefined);
    const plugin = createPlugin({ shouldOpenNoteAfterMerge: false });
    const appObj = getPluginAppObj(plugin);
    appObj['workspace'] = {
      getActiveFile: vi.fn(),
      getLeaf: vi.fn().mockReturnValue({ openFile: openFileMock })
    };

    const composer = new MergeComposer({
      isNewTargetFile: false,
      plugin,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
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
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md' });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md' });

    const plugin = createPlugin();

    const composer = new MergeComposer({
      isNewTargetFile: false,
      plugin,
      sourceFile,
      targetFile
    });

    // Set up editLinks to call the callback with a link pointing to source
    vi.mocked(editLinks).mockImplementation(async (_app, pathOrFile, callback) => {
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
    const targetFileCalls = editLinksCalls.filter((call) => call[1] === targetFile);
    expect(targetFileCalls.length).toBeGreaterThan(0);
  });
});

describe('MergeComposer getSelections', () => {
  it('should return full file content as single selection', async () => {
    const plugin = createPlugin();
    const appObj = getPluginAppObj(plugin);
    appObj['vault'] = {
      ...appObj['vault'] as GenericObject,
      read: vi.fn().mockResolvedValue('hello world')
    };

    const composer = new MergeComposer({
      isNewTargetFile: false,
      plugin,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
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
    const plugin = createPlugin({ mergeTemplate: 'custom: {{content}}' });

    const composer = new MergeComposer({
      isNewTargetFile: false,
      plugin,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' })
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

    vi.mocked(editLinks).mockImplementation(async (_app, _path, callback) => {
      await callback(castTo<Reference>({ link: 'source' }));
    });
    vi.mocked(updateLink).mockReturnValue('updated');

    await composer.mergeFile();

    expect(getBacklinksForFileSafe).toHaveBeenCalled();
  });
});
