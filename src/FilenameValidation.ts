import type { App } from 'obsidian';

export const INVALID_CHARACTERS_REG_EXP = /[*\\<>:|?#^[\]"]+/g;
export const TRAILING_DOTS_OR_SPACES_REG_EXP = /[ .]+$/g;

export function isValidFilename(app: App, fileName: string): boolean {
  try {
    app.vault.checkPath(fileName);
    return true;
  } catch {
    return false;
  }
}
