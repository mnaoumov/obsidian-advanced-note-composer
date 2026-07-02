import type {
  App,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import {
  getFolderOrNull,
  isFile,
  isFolder
} from 'obsidian-dev-utils/obsidian/file-system';
import {
  getAvailablePath,
  isChild
} from 'obsidian-dev-utils/obsidian/vault';
import { join } from 'obsidian-dev-utils/path';

/**
 * Parameters for {@link swap}.
 */
export interface SwapParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * Whether to swap the entire folder subtree (folders and their descendants), not just direct files.
   */
  readonly shouldSwapEntireFolderStructure: boolean;

  /**
   * The first file or folder to swap.
   */
  readonly sourceFile: TAbstractFile;

  /**
   * The second file or folder to swap.
   */
  readonly targetFile: TAbstractFile;

  /**
   * The transaction all mutations are routed through so the swap can be rolled back atomically.
   */
  readonly vaultTransaction: VaultTransaction;
}

export async function swap(params: SwapParams): Promise<void> {
  const { app, shouldSwapEntireFolderStructure, sourceFile, targetFile, vaultTransaction } = params;

  if (isFile(sourceFile) && isFile(targetFile)) {
    await swapFile(vaultTransaction, app, sourceFile, targetFile);
    return;
  }

  if (isFolder(sourceFile) && isFolder(targetFile)) {
    await swapFolder(vaultTransaction, app, sourceFile, targetFile, shouldSwapEntireFolderStructure);
    return;
  }

  throw new Error('Cannot swap files and folders.');
}

async function swapFile(vaultTransaction: VaultTransaction, app: App, sourceFile: TFile, targetFile: TFile): Promise<void> {
  const sourceFilePath = sourceFile.path;
  const targetFilePath = targetFile.path;
  const targetFileTempPath = getAvailablePath(app, targetFilePath);
  await vaultTransaction.rename(sourceFilePath, targetFileTempPath);
  await vaultTransaction.rename(targetFile, sourceFilePath);
  await vaultTransaction.rename(targetFileTempPath, targetFilePath);
}

async function swapFolder(
  vaultTransaction: VaultTransaction,
  app: App,
  sourceFolder: TFolder,
  targetFolder: TFolder,
  shouldSwapEntireFolderStructure: boolean
): Promise<void> {
  const sourceFolderName = sourceFolder.name;
  const targetFolderName = targetFolder.name;

  if (sourceFolderName !== targetFolderName) {
    /* v8 ignore start -- parent?.path ?? '' is defensive; folders always have a parent in practice. */
    const sourceFolderWithTargetName = join(sourceFolder.parent?.path ?? '', targetFolderName);
    /* v8 ignore stop */
    await vaultTransaction.rename(sourceFolder, sourceFolderWithTargetName);

    /* v8 ignore start -- parent?.path ?? '' is defensive; folders always have a parent in practice. */
    const targetFolderWithSourceName = join(targetFolder.parent?.path ?? '', sourceFolderName);
    /* v8 ignore stop */
    await vaultTransaction.rename(targetFolder, targetFolderWithSourceName);

    if (sourceFolder.name !== targetFolderName && getFolderOrNull({ app, pathOrFolder: sourceFolderWithTargetName }) === null) {
      await vaultTransaction.rename(sourceFolder, sourceFolderWithTargetName);
    }

    /* v8 ignore start -- second name-retry: reachable only when a folder rename does not cascade to its descendants, which real Obsidian does but test-mocks does not; see obsidian-test-mocks CLAUDE.md (Vault.rename does not cascade folder-descendant paths).  */
    if (targetFolder.name !== sourceFolderName && getFolderOrNull({ app, pathOrFolder: targetFolderWithSourceName }) === null) {
      await vaultTransaction.rename(targetFolder, targetFolderWithSourceName);
    }
    /* v8 ignore stop */
  }

  const tempFolderPath = getAvailablePath(app, '__temp');
  await vaultTransaction.createFolder(tempFolderPath);

  let sourceChildren = Array.from(sourceFolder.children);
  if (!shouldSwapEntireFolderStructure) {
    sourceChildren = sourceChildren.filter(isFile);
  }

  const targetFolderPath = targetFolder.path;

  for (const sourceChild of sourceChildren) {
    await vaultTransaction.rename(sourceChild, join(tempFolderPath, sourceChild.name));
  }

  let targetChildren = Array.from(targetFolder.children);
  if (!shouldSwapEntireFolderStructure) {
    targetChildren = targetChildren.filter(isFile);
  }

  for (const targetChild of targetChildren) {
    /* v8 ignore start -- nested swap (target contains source): reachable only when a folder rename cascades to descendants, which test-mocks does not model; see obsidian-test-mocks CLAUDE.md (Vault.rename does not cascade folder-descendant paths).  */
    if (isChild({ app, childPathOrFile: sourceFolder, parentPathOrFile: targetChild })) {
      continue;
    }
    /* v8 ignore stop */
    await vaultTransaction.rename(targetChild, join(sourceFolder.path, targetChild.name));
  }

  /* v8 ignore start -- final target-folder rename after a name swap: reachable only via the descendant-cascade path test-mocks lacks; see obsidian-test-mocks CLAUDE.md (Vault.rename does not cascade folder-descendant paths).  */
  if (targetFolder.path !== targetFolderPath) {
    await vaultTransaction.rename(targetFolder, targetFolderPath);
  }
  /* v8 ignore stop */

  for (const sourceChild of sourceChildren) {
    /* v8 ignore start -- skip a source child no longer staged: reachable only when a folder rename cascades to descendants, which test-mocks does not model; see obsidian-test-mocks CLAUDE.md (Vault.rename does not cascade folder-descendant paths).  */
    if (!isChild({ app, childPathOrFile: sourceChild, parentPathOrFile: tempFolderPath })) {
      continue;
    }
    /* v8 ignore stop */
    await vaultTransaction.rename(sourceChild, join(targetFolder.path, sourceChild.name));
  }

  await vaultTransaction.trash(tempFolderPath);
}
