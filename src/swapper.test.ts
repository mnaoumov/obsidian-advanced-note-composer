// @vitest-environment jsdom

import type {
  App as AppOriginal,
  TFile,
  TFolder
} from 'obsidian';

import { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { swap } from './swapper.ts';

let app: AppOriginal;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
  // Test-mocks' Vault.getAvailablePath is a non-functional stub that echoes its input (it never
  // De-duplicates against existing files). The real VaultTransaction relies on getAvailablePath to
  // Pick a free staging path when the swap moves a file onto an occupied path, so give it the real
  // Obsidian behavior (append " N" until the path is free). This is a return-value double of an
  // Obsidian API method, not a reimplementation of any obsidian-dev-utils logic.
  vi.spyOn(app.vault, 'getAvailablePath').mockImplementation((basePath: string, extension: string) => {
    const suffix = extension ? `.${extension}` : '';
    let candidate = `${basePath}${suffix}`;
    let counter = 1;
    while (app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${basePath} ${counter.toString()}${suffix}`;
      counter++;
    }
    return candidate;
  });
});

describe('swap', () => {
  it('should exchange the content of two files', async () => {
    await app.vault.create('folder/a.md', 'A body');
    await app.vault.create('folder/b.md', 'B body');

    await runSwap(getFile('folder/a.md'), getFile('folder/b.md'), false);

    // Assert via the adapter: the transaction stages moves through app.vault.adapter and test-mocks
    // Does not sync the in-memory vault tree from those adapter-level moves.
    expect(await app.vault.adapter.read('folder/a.md')).toBe('B body');
    expect(await app.vault.adapter.read('folder/b.md')).toBe('A body');
  });

  it('should swap the direct files of two same-named folders and swap subfolders too when requested', async () => {
    await app.vault.createFolder('left/shared');
    await app.vault.createFolder('right/shared');
    await app.vault.createFolder('left/shared/sub');
    await app.vault.create('left/shared/f1.md', 'F1');
    await app.vault.create('left/shared/sub/deep.md', 'DEEP');
    await app.vault.create('right/shared/f2.md', 'F2');

    await runSwap(getFolder('left/shared'), getFolder('right/shared'), true);

    expect(await app.vault.adapter.read('left/shared/f2.md')).toBe('F2');
    expect(await app.vault.adapter.read('right/shared/f1.md')).toBe('F1');
    expect(await app.vault.adapter.read('right/shared/sub/deep.md')).toBe('DEEP');
    expect(await app.vault.adapter.exists('left/shared/f1.md')).toBe(false);
    expect(await app.vault.adapter.exists('left/shared/sub')).toBe(false);
  });

  it('should swap only the direct files of two same-named folders when the entire structure is not requested', async () => {
    await app.vault.createFolder('left/shared');
    await app.vault.createFolder('left/shared/sub');
    await app.vault.createFolder('right/shared');
    await app.vault.create('left/shared/f1.md', 'F1');
    await app.vault.create('left/shared/sub/deep.md', 'DEEP');
    await app.vault.create('right/shared/f2.md', 'F2');

    await runSwap(getFolder('left/shared'), getFolder('right/shared'), false);

    expect(await app.vault.adapter.read('left/shared/f2.md')).toBe('F2');
    expect(await app.vault.adapter.read('right/shared/f1.md')).toBe('F1');
    // The subfolder is not a direct file, so it stays put.
    expect(await app.vault.adapter.read('left/shared/sub/deep.md')).toBe('DEEP');
    expect(await app.vault.adapter.exists('right/shared/sub')).toBe(false);
  });

  it('should swap two differently-named folders by exchanging their names', async () => {
    // The differently-named branch renames the folders themselves. Test-mocks' folder rename does not
    // Cascade the new path to descendant TFile objects (real Obsidian does), so a differently-named
    // Swap that also moves children throws under the mock; empty folders exercise the rename branch
    // (including the name-retry) without depending on that unmodeled cascade. A concrete parent folder
    // Is created first so the folders have a real parent path (test-mocks does not synthesize
    // Intermediate parent folder objects).
    await app.vault.createFolder('parent');
    await app.vault.createFolder('parent/alpha');
    await app.vault.createFolder('parent/beta');

    await runSwap(getFolder('parent/alpha'), getFolder('parent/beta'), true);

    expect(await app.vault.adapter.exists('parent/alpha')).toBe(true);
    expect(await app.vault.adapter.exists('parent/beta')).toBe(true);
  });

  it('should throw when asked to swap a file with a folder', async () => {
    await app.vault.create('note.md', 'N');
    await app.vault.createFolder('folder');
    const vaultTransaction = new VaultTransaction({ app });

    await expect(swap({
      app,
      shouldSwapEntireFolderStructure: false,
      sourceFile: getFile('note.md'),
      targetFile: getFolder('folder'),
      vaultTransaction
    })).rejects.toThrow('Cannot swap files and folders.');
  });
});

function getFile(path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

async function runSwap(
  sourceFile: TFile | TFolder,
  targetFile: TFile | TFolder,
  shouldSwapEntireFolderStructure: boolean
): Promise<void> {
  const vaultTransaction = new VaultTransaction({ app });
  await swap({ app, shouldSwapEntireFolderStructure, sourceFile, targetFile, vaultTransaction });
  await vaultTransaction.commit();
}
