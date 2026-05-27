import type {
  App,
  TAbstractFile,
  TFile,
  TFolder,
  Vault
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
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { swap } from './swapper.ts';

interface NamedFile {
  name: string;
}

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
  join: (...args: string[]): string => args.filter(Boolean).join('/')
}));

const mockIsFile = vi.mocked(isFile);
const mockIsFolder = vi.mocked(isFolder);
const mockGetAvailablePath = vi.mocked(getAvailablePath);
const mockRenameSafe = vi.mocked(renameSafe);
const mockDeleteIfNotUsed = vi.mocked(deleteIfNotUsed);
const mockIsChild = vi.mocked(isChild);
const mockGetFolderOrNull = vi.mocked(getFolderOrNull);

function createMockApp(): App {
  return strictProxy<App>({
    vault: strictProxy<Vault>({
      createFolder: vi.fn().mockResolvedValue(strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' }))
    })
  });
}

function createMockFile(path: string): TFile {
  return strictProxy<TFile>({ name: ensureNonNullable(path.split('/').pop()), path });
}

function createMockFolder(path: string, name: string, children: TAbstractFile[] = []): TFolder {
  const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return strictProxy<TFolder>({
    children,
    name,
    parent: strictProxy<TFolder>({ path: parentPath }),
    path
  });
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
    const tempFolder = strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' });

    const app = strictProxy<App>({
      vault: strictProxy<Vault>({
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      })
    });

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
    const tempFolder = strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' });

    const app = strictProxy<App>({
      vault: strictProxy<Vault>({
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      })
    });

    mockIsFile.mockReturnValue(false);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    mockRenameSafe.mockImplementation((_app, file, newPath) => {
      if (typeof file === 'object' && 'name' in file) {
        (file as NamedFile).name = newPath.split('/').pop() ?? '';
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

  it('should retry rename when folder name did not change after first rename', async () => {
    const sourceChild = createMockFile('folderA/file1.md');
    const targetChild = createMockFile('folderB/file2.md');
    const source = createMockFolder('folderA', 'folderA', [sourceChild]);
    const target = createMockFolder('folderB', 'folderB', [targetChild]);
    const tempFolder = strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' });

    const app = strictProxy<App>({
      vault: strictProxy<Vault>({
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      })
    });

    mockIsFile.mockReturnValue(false);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    // After first rename, names don't change (simulates rename failure)
    mockRenameSafe.mockResolvedValue('');
    // GetFolderOrNull returns null, meaning the target path doesn't exist yet, so retry rename
    mockGetFolderOrNull.mockReturnValue(null);
    mockIsChild.mockReturnValue(false);
    mockDeleteIfNotUsed.mockResolvedValue(false);

    await swap(app, source, target, true);

    // RenameSafe should be called extra times for the retry
    expect(mockRenameSafe).toHaveBeenCalled();
    expect(mockDeleteIfNotUsed).toHaveBeenCalledWith(app, tempFolder);
  });

  it('should skip target child when isChild returns true for source and target child', async () => {
    const sourceChild = createMockFile('folderA/file1.md');
    const targetChild = createMockFile('folderB/file2.md');
    const source = createMockFolder('src', 'same', [sourceChild]);
    const target = createMockFolder('target', 'same', [targetChild]);
    const tempFolder = strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' });

    const app = strictProxy<App>({
      vault: strictProxy<Vault>({
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      })
    });

    mockIsFile.mockReturnValue(false);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    mockRenameSafe.mockResolvedValue('');
    // IsChild(app, sourceFolder, targetChild) returns true
    mockIsChild.mockImplementation((_app, a, b) => {
      if (a === source && b === targetChild) {
        return true;
      }
      if (b === tempFolder) {
        return a === sourceChild;
      }
      return false;
    });
    mockDeleteIfNotUsed.mockResolvedValue(false);

    await swap(app, source, target, true);

    expect(mockDeleteIfNotUsed).toHaveBeenCalledWith(app, tempFolder);
  });

  it('should rename target folder back when its path changed', async () => {
    const sourceChild = createMockFile('folderA/file1.md');
    const targetChild = createMockFile('folderB/file2.md');
    const source = createMockFolder('src', 'same', [sourceChild]);
    const target = createMockFolder('target', 'same', [targetChild]);
    const tempFolder = strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' });

    const app = strictProxy<App>({
      vault: strictProxy<Vault>({
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      })
    });

    mockIsFile.mockReturnValue(false);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');

    const originalTargetPath = target.path;
    mockRenameSafe.mockImplementation((_app, file, _newPath) => {
      // Simulate target folder path changing during swap
      if (file === targetChild) {
        Object.defineProperty(target, 'path', { configurable: true, value: 'changed-path' });
      }
      return Promise.resolve('');
    });
    mockIsChild.mockImplementation((_app, child, parent) => {
      if (parent === tempFolder) {
        return child === sourceChild;
      }
      return false;
    });
    mockDeleteIfNotUsed.mockResolvedValue(false);

    await swap(app, source, target, true);

    // Verify renameSafe was called to fix the target folder path
    expect(mockRenameSafe).toHaveBeenCalled();
    expect(mockDeleteIfNotUsed).toHaveBeenCalledWith(app, tempFolder);

    // Restore original path
    Object.defineProperty(target, 'path', { configurable: true, value: originalTargetPath });
  });

  it('should skip source child not in temp folder when moving back', async () => {
    const sourceChild = createMockFile('folderA/file1.md');
    const targetChild = createMockFile('folderB/file2.md');
    const source = createMockFolder('src', 'same', [sourceChild]);
    const target = createMockFolder('target', 'same', [targetChild]);
    const tempFolder = strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' });

    const app = strictProxy<App>({
      vault: strictProxy<Vault>({
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      })
    });

    mockIsFile.mockReturnValue(false);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    mockRenameSafe.mockResolvedValue('');
    // SourceChild is NOT in tempFolder (e.g., it was moved elsewhere)
    mockIsChild.mockReturnValue(false);
    mockDeleteIfNotUsed.mockResolvedValue(false);

    await swap(app, source, target, true);

    expect(mockDeleteIfNotUsed).toHaveBeenCalledWith(app, tempFolder);
  });

  it('should only swap files when shouldSwapEntireFolderStructure is false', async () => {
    const sourceFile = createMockFile('folderA/file1.md');
    const sourceSubfolder = createMockFolder('folderA/sub', 'sub');
    const targetFile = createMockFile('folderB/file2.md');
    const source = createMockFolder('src', 'src', [sourceFile, sourceSubfolder]);
    const target = createMockFolder('target', 'target', [targetFile]);
    const tempFolder = strictProxy<TFolder>({ children: [], name: '__temp', path: '__temp' });

    const app = strictProxy<App>({
      vault: strictProxy<Vault>({
        createFolder: vi.fn().mockResolvedValue(tempFolder)
      })
    });

    mockIsFile.mockImplementation((f) => f === sourceFile || f === targetFile);
    mockIsFolder.mockImplementation((f) => f === source || f === target);
    mockGetAvailablePath.mockReturnValue('__temp');
    mockRenameSafe.mockImplementation((_app, file, newPath) => {
      if (typeof file === 'object' && 'name' in file) {
        (file as NamedFile).name = newPath.split('/').pop() ?? '';
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
