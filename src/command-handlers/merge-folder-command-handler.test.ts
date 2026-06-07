import type {
  App,
  MetadataCache,
  TAbstractFile,
  TFile,
  TFolder,
  Vault,
  WorkspaceLeaf
} from 'obsidian';

import {
  Notice,
  Vault as VaultClass
} from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  exists,
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  getAvailablePath,
  getOrCreateFileSafe,
  getOrCreateFolderSafe,
  isChildOrSelf,
  renameSafe,
  trashSafe
} from 'obsidian-dev-utils/obsidian/vault';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { Plugin } from '../plugin.ts';

import { MergeComposer } from '../composers/merge-composer.ts';
import { selectTargetFolderForMergeFolder } from '../modals/merge-folder-modal.ts';
import { MergeFolderCommandHandler } from './merge-folder-command-handler.ts';

interface TestableHandler {
  canExecuteFolder(folder: TFolder): boolean;
  executeFolder(folder: TFolder): Promise<void>;
  params: unknown;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFolderMenu(folder: TFolder, source: string, leaf?: WorkspaceLeaf): boolean;
}

vi.mock('obsidian', () => ({
  Notice: vi.fn(),
  Vault: {
    recurseChildren: vi.fn()
  }
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/command-handlers/folder-command-handler', () => {
  class FolderCommandHandler {
    public readonly params: unknown;
    public constructor(params: unknown) {
      this.params = params;
    }

    protected canExecuteFolder(_folder: unknown): boolean {
      return true;
    }

    protected shouldAddCommandToSubmenu(): boolean | undefined {
      return undefined;
    }

    protected shouldAddToFolderMenu(_folder: unknown, _source: unknown, _leaf?: unknown): boolean {
      return false;
    }
  }
  return { FolderCommandHandler };
});

vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  exists: vi.fn(),
  FileSystemType: { File: 'File' },
  isFile: vi.fn(),
  isFolder: vi.fn(),
  isMarkdownFile: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  getAvailablePath: vi.fn(),
  getOrCreateFileSafe: vi.fn(),
  getOrCreateFolderSafe: vi.fn(),
  isChildOrSelf: vi.fn(),
  renameSafe: vi.fn(),
  trashSafe: vi.fn()
}));

vi.mock('obsidian-dev-utils/path', () => ({
  join: (...args: string[]): string => args.filter(Boolean).join('/'),
  relative: (from: string, to: string): string => to.slice(from.length + 1)
}));

vi.mock('../composers/merge-composer.ts', () => {
  const MockMergeComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockMergeComposer.prototype.mergeFile = vi.fn().mockResolvedValue(undefined);
  return { MergeComposer: MockMergeComposer };
});

vi.mock('../modals/merge-folder-modal.ts', () => ({
  selectTargetFolderForMergeFolder: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockSelectTargetFolder = vi.mocked(selectTargetFolderForMergeFolder);
const MockNotice = vi.mocked(Notice);
const MockMergeComposer = vi.mocked(MergeComposer);
const mockRecurseChildren = vi.mocked(VaultClass.recurseChildren);
const mockIsFile = vi.mocked(isFile);
const mockIsFolder = vi.mocked(isFolder);
const mockIsMarkdownFile = vi.mocked(isMarkdownFile);
const mockExists = vi.mocked(exists);
const mockGetOrCreateFileSafe = vi.mocked(getOrCreateFileSafe);
const mockGetOrCreateFolderSafe = vi.mocked(getOrCreateFolderSafe);
const mockGetAvailablePath = vi.mocked(getAvailablePath);
const mockRenameSafe = vi.mocked(renameSafe);
const mockTrashSafe = vi.mocked(trashSafe);
const mockIsChildOrSelf = vi.mocked(isChildOrSelf);

interface CreateMockPluginParams {
  readonly isPathIgnored?: boolean;
  readonly shouldAddCommandsToSubmenu?: boolean;
  readonly shouldRunTemplaterOnDestinationFile?: boolean;
  readonly templaterInstalled?: boolean;
}

function createMockFile(path: string): TFile {
  const name = path.split('/').pop() ?? '';
  return strictProxy<TFile>({ name, parent: strictProxy<TFolder>({ path: path.slice(0, path.lastIndexOf('/')) }), path });
}

function createMockFolder(path: string, isRoot = false, children: TAbstractFile[] = []): TFolder {
  return strictProxy<TFolder>({
    children,
    isRoot: vi.fn().mockReturnValue(isRoot),
    path
  });
}

function createMockPlugin(params: CreateMockPluginParams = {}): Plugin {
  const {
    isPathIgnored = false,
    shouldAddCommandsToSubmenu = true,
    shouldRunTemplaterOnDestinationFile = false,
    templaterInstalled = false
  } = params;
  const pluginsRecord = Object.assign(Object.create(null), templaterInstalled ? { 'templater-obsidian': {} } : {});
  return strictProxy<Plugin>({
    app: strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({}),
      plugins: strictProxy<App['plugins']>({
        plugins: pluginsRecord
      }),
      vault: strictProxy<Vault>({})
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldRunTemplaterOnDestinationFile
      })
    })
  });
}

function toTestable(handler: MergeFolderCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MergeFolderCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    expect(handler.params).toStrictEqual({
      fileMenuItemName: 'Merge entire folder with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'merge',
      id: 'merge-folder',
      name: 'Merge current folder with another folder...'
    });
  });

  it('should return false from canExecuteFolder when folder is root', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const folder = createMockFolder('/', true);
    expect(handler.canExecuteFolder(folder)).toBe(false);
  });

  it('should return true from canExecuteFolder when folder is not root', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const folder = createMockFolder('some/folder', false);
    expect(handler.canExecuteFolder(folder)).toBe(true);
  });

  it('should show notice and return when path is ignored', async () => {
    const plugin = createMockPlugin({ isPathIgnored: true });
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const folder = createMockFolder('test/folder');

    const mockFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockFragment);
      return mockFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    await handler.executeFolder(folder);

    expect(MockNotice).toHaveBeenCalled();
    expect(mockSelectTargetFolder).not.toHaveBeenCalled();
  });

  it('should return when selectTargetFolderForMergeFolder returns null', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const folder = createMockFolder('test/folder');

    mockSelectTargetFolder.mockResolvedValue(null);

    await handler.executeFolder(folder);

    expect(mockRecurseChildren).not.toHaveBeenCalled();
  });

  it('should merge folders on happy path', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    mockRecurseChildren.mockImplementation((_folder, _cb) => {
      // No children
    });
    mockIsChildOrSelf.mockReturnValue(false);

    await handler.executeFolder(sourceFolder);

    expect(noticeHide).toHaveBeenCalled();
  });

  it('should merge markdown files and move non-markdown files', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    const mdFile = createMockFile('src/note.md');
    const otherFile = createMockFile('src/image.png');
    const subfolder = createMockFolder('src/sub', false, []);

    mockRecurseChildren.mockImplementation((_folder, cb) => {
      cb(subfolder);
      cb(mdFile);
      cb(otherFile);
    });

    mockIsFolder.mockImplementation((f) => f === subfolder);
    mockIsFile.mockImplementation((f) => f === mdFile || f === otherFile);
    mockIsMarkdownFile.mockImplementation((_app, f) => f === mdFile);
    mockGetOrCreateFolderSafe.mockResolvedValue(strictProxy<TFolder>({ path: 'target/sub' }));
    mockIsChildOrSelf.mockReturnValue(false);

    mockExists.mockReturnValue(false);
    const targetMdFile = createMockFile('target/note.md');
    mockGetOrCreateFileSafe.mockResolvedValue(targetMdFile);

    const mockMergeFile = vi.fn().mockResolvedValue(undefined);
    MockMergeComposer.prototype.mergeFile = mockMergeFile;

    mockGetAvailablePath.mockReturnValue('target/image.png');
    mockRenameSafe.mockResolvedValue('');
    mockTrashSafe.mockResolvedValue(undefined);

    await handler.executeFolder(sourceFolder);

    expect(MockMergeComposer).toHaveBeenCalled();
    expect(mockMergeFile).toHaveBeenCalled();
    expect(mockRenameSafe).toHaveBeenCalled();
    expect(noticeHide).toHaveBeenCalled();
  });

  it('should delete empty source subfolders that are not target ancestors', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    const emptySubfolder = createMockFolder('src/empty', false, []);
    mockRecurseChildren.mockImplementation((_folder, cb) => {
      cb(emptySubfolder);
    });

    mockIsFolder.mockImplementation((f) => f === emptySubfolder);
    mockIsFile.mockReturnValue(false);
    mockGetOrCreateFolderSafe.mockResolvedValue(strictProxy<TFolder>({ path: 'target/empty' }));
    mockIsChildOrSelf.mockReturnValue(false);
    mockTrashSafe.mockResolvedValue(undefined);

    await handler.executeFolder(sourceFolder);

    expect(mockTrashSafe).toHaveBeenCalled();
    expect(noticeHide).toHaveBeenCalled();
  });

  it('should not delete source subfolder when target is a child of it', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    const subfolder = createMockFolder('src/sub', false, []);
    mockRecurseChildren.mockImplementation((_folder, cb) => {
      cb(subfolder);
    });

    mockIsFolder.mockImplementation((f) => f === subfolder);
    mockIsFile.mockReturnValue(false);
    mockGetOrCreateFolderSafe.mockResolvedValue(strictProxy<TFolder>({ path: 'target/sub' }));
    mockIsChildOrSelf.mockImplementation((_app, targetPath, sourceSubfolder) => {
      if (targetPath === 'target/sub' && sourceSubfolder === subfolder) {
        return true;
      }
      return false;
    });
    mockTrashSafe.mockResolvedValue(undefined);

    await handler.executeFolder(sourceFolder);

    expect(mockTrashSafe).not.toHaveBeenCalled();
  });

  it('should not delete subfolder when it has children', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    const child = createMockFile('src/sub/child.md');
    const subfolder = createMockFolder('src/sub', false, [child]);
    mockRecurseChildren.mockImplementation((_folder, cb) => {
      cb(subfolder);
    });

    mockIsFolder.mockImplementation((f) => f === subfolder);
    mockIsFile.mockReturnValue(false);
    mockGetOrCreateFolderSafe.mockResolvedValue(strictProxy<TFolder>({ path: 'target/sub' }));
    mockIsChildOrSelf.mockReturnValue(false);

    await handler.executeFolder(sourceFolder);

    expect(mockTrashSafe).not.toHaveBeenCalled();
  });

  it('should show notice when templater setting is enabled but plugin is not installed', async () => {
    const plugin = createMockPlugin({ shouldRunTemplaterOnDestinationFile: true, templaterInstalled: false });
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    mockRecurseChildren.mockImplementation((_folder, _cb) => {
      // No children
    });
    mockIsChildOrSelf.mockReturnValue(false);

    await handler.executeFolder(sourceFolder);

    expect(MockNotice).toHaveBeenCalledTimes(2);
  });

  it('should not show templater notice when templater is installed', async () => {
    const plugin = createMockPlugin({ shouldRunTemplaterOnDestinationFile: true, templaterInstalled: true });
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    mockRecurseChildren.mockImplementation((_folder, _cb) => {
      // No children
    });
    mockIsChildOrSelf.mockReturnValue(false);

    await handler.executeFolder(sourceFolder);

    expect(MockNotice).toHaveBeenCalledTimes(1);
  });

  it('should sort md files by depth ascending when source is child of target', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    const file1 = createMockFile('src/a/b/deep.md');
    const file2 = createMockFile('src/shallow.md');

    mockRecurseChildren.mockImplementation((_folder, cb) => {
      cb(file1);
      cb(file2);
    });

    mockIsFolder.mockReturnValue(false);
    mockIsFile.mockReturnValue(true);
    mockIsMarkdownFile.mockReturnValue(true);

    let isChildOrSelfCallCount = 0;
    mockIsChildOrSelf.mockImplementation(() => {
      isChildOrSelfCallCount++;
      if (isChildOrSelfCallCount === 1) {
        return true;
      }
      return false;
    });

    mockExists.mockReturnValue(false);
    const targetMdFile = createMockFile('target/note.md');
    mockGetOrCreateFileSafe.mockResolvedValue(targetMdFile);

    const mockMergeFile = vi.fn().mockResolvedValue(undefined);
    MockMergeComposer.prototype.mergeFile = mockMergeFile;

    await handler.executeFolder(sourceFolder);

    expect(mockMergeFile).toHaveBeenCalledTimes(2);
  });

  it('should return shouldAddCommandsToSubmenu setting value', () => {
    const plugin = createMockPlugin({ shouldAddCommandsToSubmenu: true });
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const plugin = createMockPlugin({ shouldAddCommandsToSubmenu: false });
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return true from shouldAddToFolderMenu', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const folder = createMockFolder('test/folder');
    expect(handler.shouldAddToFolderMenu(folder, 'source')).toBe(true);
  });

  it('should hide notice even when mergeFolderImpl throws', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    mockRecurseChildren.mockImplementation(() => {
      throw new Error('test error');
    });

    await expect(handler.executeFolder(sourceFolder)).rejects.toThrow('test error');
    expect(noticeHide).toHaveBeenCalled();
  });

  it('should skip children that are neither folder nor file', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    const unknownChild = strictProxy<TAbstractFile>({ path: 'src/unknown' });
    mockRecurseChildren.mockImplementation((_folder, cb) => {
      cb(unknownChild);
    });

    mockIsFolder.mockReturnValue(false);
    mockIsFile.mockReturnValue(false);
    mockIsChildOrSelf.mockReturnValue(false);

    await handler.executeFolder(sourceFolder);

    expect(MockMergeComposer).not.toHaveBeenCalled();
    expect(mockRenameSafe).not.toHaveBeenCalled();
    expect(noticeHide).toHaveBeenCalled();
  });

  it('should sort md files by depth descending when target is child of source', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFolderCommandHandler(plugin));
    const sourceFolder = createMockFolder('src');
    const targetFolder = createMockFolder('target');

    mockSelectTargetFolder.mockResolvedValue(targetFolder);

    const noticeHide = vi.fn();
    // eslint-disable-next-line prefer-arrow-callback -- Arrow functions cannot be used as constructors with `new`.
    MockNotice.mockImplementation(function mockNoticeConstructor() {
      return strictProxy<Notice>({ hide: noticeHide });
    });

    const mockNoticeFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn(),
      createDiv: vi.fn(),
      createEl: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockNoticeFragment);
      return mockNoticeFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    const file1 = createMockFile('src/shallow.md');
    const file2 = createMockFile('src/a/b/deep.md');

    mockRecurseChildren.mockImplementation((_folder, cb) => {
      cb(file1);
      cb(file2);
    });

    mockIsFolder.mockReturnValue(false);
    mockIsFile.mockReturnValue(true);
    mockIsMarkdownFile.mockReturnValue(true);

    let isChildOrSelfCallCount = 0;
    mockIsChildOrSelf.mockImplementation(() => {
      isChildOrSelfCallCount++;
      // First call: isChildOrSelf(sourceFolder, targetFolder) -> false
      // Second call: isChildOrSelf(targetFolder, sourceFolder) -> true
      if (isChildOrSelfCallCount === 2) {
        return true;
      }
      return false;
    });

    mockExists.mockReturnValue(false);
    const targetMdFile = createMockFile('target/note.md');
    mockGetOrCreateFileSafe.mockResolvedValue(targetMdFile);

    const mockMergeFile = vi.fn().mockResolvedValue(undefined);
    MockMergeComposer.prototype.mergeFile = mockMergeFile;

    await handler.executeFolder(sourceFolder);

    expect(mockMergeFile).toHaveBeenCalledTimes(2);
    expect(noticeHide).toHaveBeenCalled();
  });
});
