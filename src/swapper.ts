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

interface SwapFileParams {
  readonly app: App;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
  readonly vaultTransaction: VaultTransaction;
}

interface SwapFolderParams {
  readonly app: App;
  readonly shouldSwapEntireFolderStructure: boolean;
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
  readonly vaultTransaction: VaultTransaction;
}

export async function swap(params: SwapParams): Promise<void> {
  const { app, shouldSwapEntireFolderStructure, sourceFile, targetFile, vaultTransaction } = params;

  if (isFile(sourceFile) && isFile(targetFile)) {
    await swapFile({ app, sourceFile, targetFile, vaultTransaction });
    return;
  }

  if (isFolder(sourceFile) && isFolder(targetFile)) {
    await swapFolder({ app, shouldSwapEntireFolderStructure, sourceFolder: sourceFile, targetFolder: targetFile, vaultTransaction });
    return;
  }

  throw new Error('Cannot swap files and folders.');
}

async function swapFile(params: SwapFileParams): Promise<void> {
  const { app, sourceFile, targetFile, vaultTransaction } = params;
  const sourceFilePath = sourceFile.path;
  const targetFilePath = targetFile.path;
  const targetFileTempPath = getAvailablePath(app, targetFilePath);
  await vaultTransaction.rename(sourceFilePath, targetFileTempPath);
  await vaultTransaction.rename(targetFile, sourceFilePath);
  await vaultTransaction.rename(targetFileTempPath, targetFilePath);
}

async function swapFolder(params: SwapFolderParams): Promise<void> {
  const { app, shouldSwapEntireFolderStructure, sourceFolder, targetFolder, vaultTransaction } = params;
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

    // Only the source folder can need a second rename: it is renamed first (into the still-occupied
    // Target slot, so it lands on a de-duplicated name), then retried onto the now-freed name once the
    // Target has vacated it. The target itself always renames into the source's already-vacated slot, so
    // It lands cleanly on its first attempt and never needs a symmetric retry.
    if (sourceFolder.name !== targetFolderName && getFolderOrNull({ app, pathOrFolder: sourceFolderWithTargetName }) === null) {
      await vaultTransaction.rename(sourceFolder, sourceFolderWithTargetName);
    }
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
    if (isChild({ app, childPathOrFile: sourceFolder, parentPathOrFile: targetChild })) {
      continue;
    }
    await vaultTransaction.rename(targetChild, join(sourceFolder.path, targetChild.name));
  }

  if (targetFolder.path !== targetFolderPath) {
    await vaultTransaction.rename(targetFolder, targetFolderPath);
  }

  for (const sourceChild of sourceChildren) {
    if (!isChild({ app, childPathOrFile: sourceChild, parentPathOrFile: tempFolderPath })) {
      continue;
    }
    await vaultTransaction.rename(sourceChild, join(targetFolder.path, sourceChild.name));
  }

  await vaultTransaction.trash(tempFolderPath);
}
