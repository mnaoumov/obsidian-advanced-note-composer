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
} from 'obsidian-dev-utils/obsidian/FileSystem';
import {
  getAvailablePath,
  isChild,
  renameSafe
} from 'obsidian-dev-utils/obsidian/Vault';
import { deleteSafe } from 'obsidian-dev-utils/obsidian/VaultEx';
import { join } from 'obsidian-dev-utils/Path';

export async function swap(app: App, sourceFile: TAbstractFile, targetFile: TAbstractFile, shouldSwapEntireFolderStructure: boolean): Promise<void> {
  if (isFile(sourceFile) && isFile(targetFile)) {
    await swapFile(app, sourceFile, targetFile);
    return;
  }

  if (isFolder(sourceFile) && isFolder(targetFile)) {
    await swapFolder(app, sourceFile, targetFile, shouldSwapEntireFolderStructure);
    return;
  }

  throw new Error('Cannot swap files and folders.');
}

async function swapFile(app: App, sourceFile: TFile, targetFile: TFile): Promise<void> {
  const sourceFilePath = sourceFile.path;
  const targetFilePath = targetFile.path;
  const targetFileTempPath = getAvailablePath(app, targetFilePath);
  await renameSafe(app, sourceFilePath, targetFileTempPath);
  await renameSafe(app, targetFile, sourceFilePath);
  await renameSafe(app, targetFileTempPath, targetFilePath);
}

async function swapFolder(app: App, sourceFolder: TFolder, targetFolder: TFolder, shouldSwapEntireFolderStructure: boolean): Promise<void> {
  const sourceFolderName = sourceFolder.name;
  const targetFolderName = targetFolder.name;

  if (sourceFolderName !== targetFolderName) {
    const sourceFolderWithTargetName = join(sourceFolder.parent?.path ?? '', targetFolderName);
    await renameSafe(app, sourceFolder, sourceFolderWithTargetName);

    const targetFolderWithSourceName = join(targetFolder.parent?.path ?? '', sourceFolderName);
    await renameSafe(app, targetFolder, targetFolderWithSourceName);

    if (sourceFolder.name !== targetFolderName && getFolderOrNull(app, sourceFolderWithTargetName) === null) {
      await renameSafe(app, sourceFolder, sourceFolderWithTargetName);
    }

    if (targetFolder.name !== sourceFolderName && getFolderOrNull(app, targetFolderWithSourceName) === null) {
      await renameSafe(app, targetFolder, targetFolderWithSourceName);
    }
  }

  const tempFolder = await app.vault.createFolder(getAvailablePath(app, '__temp'));

  let sourceChildren = Array.from(sourceFolder.children);
  if (!shouldSwapEntireFolderStructure) {
    sourceChildren = sourceChildren.filter(isFile);
  }

  const targetFolderPath = targetFolder.path;

  for (const sourceChild of sourceChildren) {
    await renameSafe(app, sourceChild, join(tempFolder.path, sourceChild.name));
  }

  let targetChildren = Array.from(targetFolder.children);
  if (!shouldSwapEntireFolderStructure) {
    targetChildren = targetChildren.filter(isFile);
  }

  for (const targetChild of targetChildren) {
    if (isChild(app, sourceFolder, targetChild)) {
      continue;
    }
    await renameSafe(app, targetChild, join(sourceFolder.path, targetChild.name));
  }

  if (targetFolder.path !== targetFolderPath) {
    await renameSafe(app, targetFolder, targetFolderPath);
  }

  for (const sourceChild of sourceChildren) {
    if (!isChild(app, sourceChild, tempFolder)) {
      continue;
    }
    await renameSafe(app, sourceChild, join(targetFolder.path, sourceChild.name));
  }

  await deleteSafe(app, tempFolder);
}
