import type { GetAvailablePathForAttachmentsExtendedFunctionParams } from '@mnaoumov/obsidian-lib/attachment-path';
import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  publishCustomAttachmentLocationStub,
  revokeCustomAttachmentLocationStubs
} from '../integrations/custom-attachment-location-stub.ts';
import {
  isAttachmentUnitFolder,
  isInsideAttachmentUnitFolder
} from './attachment-unit-folders.ts';

let app: AppOriginal;

afterEach(() => {
  revokeCustomAttachmentLocationStubs();
});

/**
 * Publishes a unit-folder designation the way an attachment-location plugin does: by publishing its
 * attachment-path API. The resolution it publishes is the native one, so nothing else the vault does changes.
 *
 * @param unitFolderPaths - The folders to designate. Only an exact path matches.
 */
function designateAttachmentUnitFolders(unitFolderPaths: readonly string[]): void {
  publishCustomAttachmentLocationStub({
    getAvailablePathForAttachments: (params) => resolveNativeAttachmentPath(params),
    isAttachmentUnitFolder: (folderPath: string) => unitFolderPaths.includes(folderPath)
  });
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

/**
 * The native resolution, which a published attachment-path API takes over from: the stand-in hands it back
 * so that designating unit folders changes nothing else.
 *
 * @param params - The resolution parameters.
 * @returns The attachment path Obsidian itself would choose.
 */
function resolveNativeAttachmentPath(params: GetAvailablePathForAttachmentsExtendedFunctionParams): Promise<string> {
  const notePathOrFile = params.notePathOrFile;
  const noteFile = typeof notePathOrFile === 'string' ? app.vault.getFileByPath(notePathOrFile) : notePathOrFile;
  return app.vault.getAvailablePathForAttachments(params.attachmentFileBaseName, params.attachmentFileExtension, noteFile);
}
