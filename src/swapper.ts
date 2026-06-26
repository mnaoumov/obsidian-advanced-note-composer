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
import { join } from 'obsidian-dev-utils/path';

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
  await renameSafe({ app, newPath: targetFileTempPath, oldPathOrAbstractFile: sourceFilePath });
  await renameSafe({ app, newPath: sourceFilePath, oldPathOrAbstractFile: targetFile });
  await renameSafe({ app, newPath: targetFilePath, oldPathOrAbstractFile: targetFileTempPath });
}

async function swapFolder(app: App, sourceFolder: TFolder, targetFolder: TFolder, shouldSwapEntireFolderStructure: boolean): Promise<void> {
  const sourceFolderName = sourceFolder.name;
  const targetFolderName = targetFolder.name;

  if (sourceFolderName !== targetFolderName) {
    /* v8 ignore start -- parent?.path ?? '' is defensive; folders always have a parent in practice. */
    const sourceFolderWithTargetName = join(sourceFolder.parent?.path ?? '', targetFolderName);
    /* v8 ignore stop */
    await renameSafe({ app, newPath: sourceFolderWithTargetName, oldPathOrAbstractFile: sourceFolder });

    /* v8 ignore start -- parent?.path ?? '' is defensive; folders always have a parent in practice. */
    const targetFolderWithSourceName = join(targetFolder.parent?.path ?? '', sourceFolderName);
    /* v8 ignore stop */
    await renameSafe({ app, newPath: targetFolderWithSourceName, oldPathOrAbstractFile: targetFolder });

    if (sourceFolder.name !== targetFolderName && getFolderOrNull({ app, pathOrFolder: sourceFolderWithTargetName }) === null) {
      await renameSafe({ app, newPath: sourceFolderWithTargetName, oldPathOrAbstractFile: sourceFolder });
    }

    if (targetFolder.name !== sourceFolderName && getFolderOrNull({ app, pathOrFolder: targetFolderWithSourceName }) === null) {
      await renameSafe({ app, newPath: targetFolderWithSourceName, oldPathOrAbstractFile: targetFolder });
    }
  }

  const tempFolder = await app.vault.createFolder(getAvailablePath(app, '__temp'));

  let sourceChildren = Array.from(sourceFolder.children);
  if (!shouldSwapEntireFolderStructure) {
    sourceChildren = sourceChildren.filter(isFile);
  }

  const targetFolderPath = targetFolder.path;

  for (const sourceChild of sourceChildren) {
    await renameSafe({ app, newPath: join(tempFolder.path, sourceChild.name), oldPathOrAbstractFile: sourceChild });
  }

  let targetChildren = Array.from(targetFolder.children);
  if (!shouldSwapEntireFolderStructure) {
    targetChildren = targetChildren.filter(isFile);
  }

  for (const targetChild of targetChildren) {
    if (isChild({ app, childPathOrFile: sourceFolder, parentPathOrFile: targetChild })) {
      continue;
    }
    await renameSafe({ app, newPath: join(sourceFolder.path, targetChild.name), oldPathOrAbstractFile: targetChild });
  }

  if (targetFolder.path !== targetFolderPath) {
    await renameSafe({ app, newPath: targetFolderPath, oldPathOrAbstractFile: targetFolder });
  }

  for (const sourceChild of sourceChildren) {
    if (!isChild({ app, childPathOrFile: sourceChild, parentPathOrFile: tempFolder })) {
      continue;
    }
    await renameSafe({ app, newPath: join(targetFolder.path, sourceChild.name), oldPathOrAbstractFile: sourceChild });
  }

  await deleteIfNotUsed({ app, pathOrFile: tempFolder });
}
