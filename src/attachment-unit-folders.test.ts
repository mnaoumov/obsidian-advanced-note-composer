import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  isAttachmentUnitFolder,
  isInsideAttachmentUnitFolder
} from './attachment-unit-folders.ts';

let app: AppOriginal;

/**
 * Publishes a unit-folder designation the way an attachment-location plugin does: as a member on the
 * patched `Vault.getAvailablePathForAttachments`. The native resolution is kept underneath, so nothing else
 * the vault does changes.
 *
 * @param unitFolderPaths - The folders to designate. Only an exact path matches.
 */
function designateAttachmentUnitFolders(unitFolderPaths: readonly string[]): void {
  const original = app.vault.getAvailablePathForAttachments.bind(app.vault);
  app.vault.getAvailablePathForAttachments = castTo<typeof app.vault.getAvailablePathForAttachments>(Object.assign(vi.fn(original), {
    checkIsAttachmentUnitFolder: (folderPath: string) => unitFolderPaths.includes(folderPath)
  }));
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(): void {
  app = App.createConfigured__({
    files: {
      'a/page_files/deep/img.png': 'PIC',
      'a/plain/note.md': 'body'
    }
  }).asOriginalType__();
}

describe('isAttachmentUnitFolder', () => {
  it('should answer false for every folder when nothing is published', () => {
    initApp();

    expect(isAttachmentUnitFolder(app, getFolder('a/page_files'))).toBe(false);
  });

  it('should answer the published designation for the folder itself', () => {
    initApp();
    designateAttachmentUnitFolders(['a/page_files']);

    expect(isAttachmentUnitFolder(app, getFolder('a/page_files'))).toBe(true);
    expect(isAttachmentUnitFolder(app, getFolder('a/page_files/deep'))).toBe(false);
    expect(isAttachmentUnitFolder(app, getFolder('a/plain'))).toBe(false);
  });

  it('should never call the vault root a unit, whatever is published', () => {
    initApp();
    designateAttachmentUnitFolders(['/', '']);

    expect(isAttachmentUnitFolder(app, app.vault.getRoot())).toBe(false);
  });
});

describe('isInsideAttachmentUnitFolder', () => {
  it('should answer false when nothing is published', () => {
    initApp();

    expect(isInsideAttachmentUnitFolder(app, getFolder('a/page_files/deep'))).toBe(false);
  });

  it('should answer true for the unit itself and for any folder under it', () => {
    initApp();
    designateAttachmentUnitFolders(['a/page_files']);

    expect(isInsideAttachmentUnitFolder(app, getFolder('a/page_files'))).toBe(true);
    expect(isInsideAttachmentUnitFolder(app, getFolder('a/page_files/deep'))).toBe(true);
  });

  it('should answer false for a folder that merely holds a unit, and for its siblings', () => {
    initApp();
    designateAttachmentUnitFolders(['a/page_files']);

    expect(isInsideAttachmentUnitFolder(app, getFolder('a'))).toBe(false);
    expect(isInsideAttachmentUnitFolder(app, getFolder('a/plain'))).toBe(false);
  });

  it('should answer false for the vault root', () => {
    initApp();
    designateAttachmentUnitFolders(['/', '']);

    expect(isInsideAttachmentUnitFolder(app, app.vault.getRoot())).toBe(false);
  });
});
