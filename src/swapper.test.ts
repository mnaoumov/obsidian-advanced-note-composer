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
  it
} from 'vitest';

import { swap } from './swapper.ts';

let app: AppOriginal;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
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

  it('should preserve every child when swapping two differently-named sibling folders', async () => {
    // Two sibling folders with different names. The differently-named branch first exchanges the folder
    // Names (which, now that test-mocks 3.5.0 cascades a folder rename to its descendants, carries the
    // Children along), then the child-swap phase moves the children back. For siblings these two phases
    // Compose to the identity, so the observable outcome is that every file stays where it started --
    // The point of this test is that a differently-named swap with children completes without data loss.
    // Reaching this branch also exercises the first (source) name-retry: the source rename collides with
    // The still-occupied target slot, lands on a de-duplicated path, then retries onto the freed name.
    await app.vault.createFolder('parent/alpha');
    await app.vault.createFolder('parent/beta');
    await app.vault.create('parent/alpha/a1.md', 'A1');
    await app.vault.create('parent/beta/b1.md', 'B1');

    await runSwap(getFolder('parent/alpha'), getFolder('parent/beta'), true);

    expect(await app.vault.adapter.read('parent/alpha/a1.md')).toBe('A1');
    expect(await app.vault.adapter.read('parent/beta/b1.md')).toBe('B1');
  });

  it('should swap a folder with a differently-named ancestor folder that contains it', async () => {
    // The target (root/a) contains the source (root/a/mid/src) several levels down. The differently-named
    // Branch exchanges their names, then the child-swap phase relocates the descendants. In the target's
    // Child loop, the branch that skips a child which itself contains the source is exercised here.
    await app.vault.createFolder('root/a/mid/src');
    await app.vault.create('root/a/mid/src/s1.md', 'S1');
    await app.vault.create('root/a/o.md', 'O');

    await runSwap(getFolder('root/a/mid/src'), getFolder('root/a'), true);

    // The source folder's file surfaces directly under the swapped-in name, the target's own file is
    // Pushed down into the relocated subtree, and no data is lost.
    expect(await app.vault.adapter.read('root/src/s1.md')).toBe('S1');
    expect(await app.vault.adapter.read('root/src/mid/a/o.md')).toBe('O');
    expect(await app.vault.adapter.exists('root/a')).toBe(false);
  });

  it('should swap a folder with a differently-named descendant folder it directly contains', async () => {
    // The source (w/outer) directly contains the target (w/outer/inner). After the name exchange, the
    // Final target-folder rename restores the target onto its captured path, and the source's child loop
    // Then skips the child that is no longer staged under the temporary folder.
    await app.vault.createFolder('w/outer/inner/deep');
    await app.vault.create('w/outer/o1.md', 'O1');
    await app.vault.create('w/outer/inner/i1.md', 'I1');
    await app.vault.create('w/outer/inner/deep/d1.md', 'D1');

    await runSwap(getFolder('w/outer'), getFolder('w/outer/inner'), true);

    expect(await app.vault.adapter.read('w/inner/i1.md')).toBe('I1');
    expect(await app.vault.adapter.read('w/inner/deep/d1.md')).toBe('D1');
    expect(await app.vault.adapter.read('w/inner/outer/o1.md')).toBe('O1');
    expect(await app.vault.adapter.exists('w/outer')).toBe(false);
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
