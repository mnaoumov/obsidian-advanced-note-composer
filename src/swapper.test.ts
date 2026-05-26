import type {
  App,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';

import {
  getFolderOrNull,
  isFile,
  isFolder
} from 'obsidian-dev-utils/obsidian/file-system';
import {
  getAvailablePath,
  isChild,
  renameSafe
} from 'obsidian-dev-utils/obsidian/vault';
import { deleteIfNotUsed } from 'obsidian-dev-utils/obsidian/vault-delete';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { swap } from './swapper.ts';

vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  getFolderOrNull: vi.fn(),
  isFile: vi.fn(),
  isFolder: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  getAvailablePath: vi.fn(),
  isChild: vi.fn(),
  renameSafe: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/vault-delete', () => ({
  deleteIfNotUsed: vi.fn()
}));

vi.mock('obsidian-dev-utils/path', () => ({
  join: (...args: string[]) => args.filter(Boolean).join('/')
}));

const mockIsFile = vi.mocked(isFile);
const mockIsFolder = vi.mocked(isFolder);
const mockGetAvailablePath = vi.mocked(getAvailablePath);
const mockRenameSafe = vi.mocked(renameSafe);
const mockDeleteIfNotUsed = vi.mocked(deleteIfNotUsed);
const mockIsChild = vi.mocked(isChild);
const mockGetFolderOrNull = vi.mocked(getFolderOrNull);

function createMockApp(): App {
  return {
    vault: {
      createFolder: vi.fn().mockResolvedValue({ children: [], name: '__temp', path: '__temp' })
    }
  } as unknown as App;
}

function createMockFile(path: string): TFile {
  return { name: path.split('/').pop(), path } as unknown as TFile;
}

function createMockFolder(path: string, name: string, children: TAbstractFile[] = []): TFolder {
  const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return {
    children,
    name,
    parent: { path: parentPath },
    path
  } as unknown as TFolder;
}

describe('swap', () => {
  it('should swap two files', async () => {
    const app = createMockApp();
    const source = createMockFile('folder/a.md');
    const target = createMockFile('folder/b.md');

    mockIsFile.mockImplementation((f) => f === source || f === target);
    mockIsFolder.mockReturnValue(false);
    mockGetAvailablePath.mockReturnValue('folder/b_1.md');
    mockRenameSafe.mockResolvedValue('');

    await swap(app, source, target, false);

    expect(mockRenameSafe).toHaveBeenCalledTimes(3);
  });

  it('should throw when swapping file and folder', async () => {
    const app = createMockApp();
    const source = createMockFile('a.md');
    const target = createMockFolder('folder', 'folder');

    mockIsFile.mockImplementation((f) => f === source);
    mockIsFolder.mockImplementation((f) => f === target);

    await expect(swap(app, source, target, false)).rejects.toThrow('Cannot swap files and folders.');
  });

  it('should swap folders with same name', async () => {
    const sourceChild = createMockFile('src/file1.md');
    const targetChild = createMockFile('target/file2.md');
    const source = createMockFolder('src', 'same', [sourceChild]);
    const target = createMockFolder('target', 'same', [targetChild]);
    const tempFolder = { children: [], name: '__temp', path: '__temp' } as unknown as TFolder;

    const app = {
      vault: {
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      }
    } as unknown as App;

    mockIsFile.mockReturnValue(false);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    mockRenameSafe.mockResolvedValue('');
    mockIsChild.mockImplementation((_app, child, parent) => {
      if (parent === tempFolder) {
        return child === sourceChild;
      }
      return false;
    });
    mockDeleteIfNotUsed.mockResolvedValue(false);

    await swap(app, source, target, true);

    expect(mockDeleteIfNotUsed).toHaveBeenCalledWith(app, tempFolder);
  });

  it('should swap folders with different names', async () => {
    const sourceChild = createMockFile('folderA/file1.md');
    const targetChild = createMockFile('folderB/file2.md');
    const source = createMockFolder('folderA', 'folderA', [sourceChild]);
    const target = createMockFolder('folderB', 'folderB', [targetChild]);
    const tempFolder = { children: [], name: '__temp', path: '__temp' } as unknown as TFolder;

    const app = {
      vault: {
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      }
    } as unknown as App;

    mockIsFile.mockReturnValue(false);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    mockRenameSafe.mockImplementation((_app, file, newPath) => {
      if (typeof file === 'object' && 'name' in file) {
        (file as { name: string }).name = newPath.split('/').pop() ?? '';
      }
      return Promise.resolve(newPath);
    });
    mockGetFolderOrNull.mockReturnValue(null);
    mockIsChild.mockImplementation((_app, child, parent) => {
      if (parent === tempFolder) {
        return child === sourceChild;
      }
      return false;
    });
    mockDeleteIfNotUsed.mockResolvedValue(false);

    await swap(app, source, target, true);

    expect(mockRenameSafe).toHaveBeenCalled();
    expect(mockDeleteIfNotUsed).toHaveBeenCalledWith(app, tempFolder);
  });

  it('should only swap files when shouldSwapEntireFolderStructure is false', async () => {
    const sourceFile = createMockFile('folderA/file1.md');
    const sourceSubfolder = createMockFolder('folderA/sub', 'sub');
    const targetFile = createMockFile('folderB/file2.md');
    const source = createMockFolder('src', 'src', [sourceFile, sourceSubfolder]);
    const target = createMockFolder('target', 'target', [targetFile]);
    const tempFolder = { children: [], name: '__temp', path: '__temp' } as unknown as TFolder;

    const app = {
      vault: {
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      }
    } as unknown as App;

    mockIsFile.mockImplementation((f) => f === sourceFile || f === targetFile);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    mockRenameSafe.mockImplementation((_app, file, newPath) => {
      if (typeof file === 'object' && 'name' in file) {
        (file as { name: string }).name = newPath.split('/').pop() ?? '';
      }
      return Promise.resolve(newPath);
    });
    mockGetFolderOrNull.mockReturnValue(null);
    mockIsChild.mockImplementation((_app, child, parent) => {
      if (parent === tempFolder) {
        return child === sourceFile;
      }
      return false;
    });
    mockDeleteIfNotUsed.mockResolvedValue(false);

    await swap(app, source, target, false);

    expect(mockDeleteIfNotUsed).toHaveBeenCalledWith(app, tempFolder);
  });
});
