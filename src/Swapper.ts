import type {
  App,
  TAbstractFile
} from 'obsidian';

import {
  getAvailablePath,
  renameSafe
} from 'obsidian-dev-utils/obsidian/Vault';

export async function swap(app: App, sourceFile: TAbstractFile, targetFile: TAbstractFile): Promise<void> {
  const sourceFilePath = sourceFile.path;
  const targetFilePath = targetFile.path;
  const targetFileTempPath = getAvailablePath(app, targetFilePath);
  await renameSafe(app, sourceFilePath, targetFileTempPath);
  await renameSafe(app, targetFile, sourceFilePath);
  await renameSafe(app, targetFileTempPath, targetFilePath);
}
