import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { GetAvailablePathForAttachmentsExtendedFunctionParams } from 'obsidian-dev-utils/obsidian/attachment-path';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { getPath } from 'obsidian-dev-utils/obsidian/file-system';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  collectFlattenItems,
  collectFlattenItemsSyncOrNull
} from './flatten-items.ts';
import { FlattenMode } from './plugin-settings.ts';

const ATTACHMENT_EXTENSIONS = ['.excalidraw.md'];

let app: AppOriginal;

async function collectPaths(folderPath: string, mode: FlattenMode): Promise<string[]> {
  const items = await collectFlattenItems({
    app,
    attachmentExtensions: ATTACHMENT_EXTENSIONS,
    folder: getFolder(folderPath),
    mode
  });
  return items.map((item) => item.path);
}

function collectPathsSyncOrNull(folderPath: string, mode: FlattenMode): null | string[] {
  const items = collectFlattenItemsSyncOrNull({
    app,
    attachmentExtensions: ATTACHMENT_EXTENSIONS,
    folder: getFolder(folderPath),
    mode
  });
  return items?.map((item) => item.path) ?? null;
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>, attachmentFolderPath = './'): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  app.vault.setConfig('attachmentFolderPath', attachmentFolderPath);
}

/**
 * Models an attachment-location plugin (e.g. Custom Attachment Location): the `extended` member it installs
 * on Obsidian's `getAvailablePathForAttachments` is what `obsidian-dev-utils` dispatches to instead of the
 * native resolution. It is the only way a note gets an attachment folder derived from its own NAME — every
 * native mode resolves the same folder for every note in a folder.
 *
 * Installed on the vault INSTANCE: the bridged member lives on `Vault.prototype`, so patching it there
 * would leak between tests.
 *
 * @param resolveAttachmentFolderPathForNote - Maps a note's path to the folder its attachments belong in.
 */
function stubAttachmentLocationPlugin(resolveAttachmentFolderPathForNote: (notePath: string) => string): void {
  function extended(params: GetAvailablePathForAttachmentsExtendedFunctionParams): Promise<string> {
    const notePath = getPath(app, ensureNonNullable(params.notePathOrFile));
    const folderPath = resolveAttachmentFolderPathForNote(notePath);
    const basePath = folderPath === '' ? params.attachmentFileBaseName : `${folderPath}/${params.attachmentFileBaseName}`;
    return Promise.resolve(`${basePath}.${params.attachmentFileExtension}`);
  }

  app.vault.getAvailablePathForAttachments = castTo<typeof app.vault.getAvailablePathForAttachments>(Object.assign(vi.fn(), { extended }));
}

describe('collectFlattenItems', () => {
  describe('AllChildren', () => {
    it('should take every direct child, files and folders alike', async () => {
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/note.md': 'note',
        'parent/a/sub/deep.md': 'deep'
      }, './attachments');

      // The original behavior is untouched by the attachment rule: an emptied folder has nothing to keep
      // Its attachments beside, so the attachment folder is promoted like any other child.
      const paths = await collectPaths('parent/a', FlattenMode.AllChildren);
      expect(paths.sort()).toStrictEqual([
        'parent/a/attachments',
        'parent/a/note.md',
        'parent/a/sub'
      ]);
    });

    it('should take nothing from an empty folder', async () => {
      initApp({ 'parent/keep.md': 'keep' });
      await app.vault.createFolder('parent/a');

      expect(await collectPaths('parent/a', FlattenMode.AllChildren)).toStrictEqual([]);
    });
  });

  describe('ChildFoldersOnly', () => {
    it('should take the child folders and leave the folder\'s own files behind', async () => {
      initApp({
        'parent/a/note.md': 'note',
        'parent/a/pic.png': 'PIC',
        'parent/a/sub/deep.md': 'deep'
      });

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    });

    it('should not take the attachment folder of a note that stays behind (issue #170)', async () => {
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/note.md': 'note',
        'parent/a/sub/deep.md': 'deep'
      }, './attachments');

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    });

    it('should take nothing when the only child folder is the attachment folder', async () => {
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      }, './attachments');

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual([]);
    });

    it('should take a child folder that holds both a note and that note\'s own attachment folder', async () => {
      // `parent/a/sub` is not protected: the note whose attachments live in `sub/attachments` travels
      // Inside `sub`, so promoting `sub` separates nothing.
      initApp({
        'parent/a/note.md': 'note',
        'parent/a/sub/attachments/pic.png': 'PIC',
        'parent/a/sub/deep.md': 'deep'
      }, './attachments');

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    });

    it('should protect nothing when attachments live beside their note', async () => {
      initApp({
        'parent/a/note.md': 'note',
        'parent/a/pic.png': 'PIC',
        'parent/a/sub/deep.md': 'deep'
      }, './');

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    });

    it('should protect nothing when attachments live in a folder outside the flattened folder', async () => {
      // A fixed attachment folder resolves outside the subtree, so a child folder merely NAMED
      // `attachments` is not this note's attachment folder and is promoted like any other.
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      }, 'Vault attachments');

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/attachments']);
    });

    it('should protect a nested attachment folder through the child folder that contains it', async () => {
      initApp({
        'parent/a/assets/img/pic.png': 'PIC',
        'parent/a/note.md': 'note',
        'parent/a/sub/deep.md': 'deep'
      }, './assets/img');

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    });

    it('should protect the per-note folder an attachment-location plugin resolves', async () => {
      initApp({
        'parent/a/note.md': 'note',
        'parent/a/note/pic.png': 'PIC',
        'parent/a/sub/deep.md': 'deep'
      });
      // Custom Attachment Location and friends derive the folder from the note's NAME, which is the one
      // Case no native mode can produce — resolved for free through `getAttachmentFolderPath` (issue #161).
      stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    });

    it('should not treat a markdown-shaped attachment as a note owning an attachment folder', async () => {
      // `drawing.excalidraw.md` is an attachment, not a note, so `attachments` belongs to nobody staying
      // Behind and is promoted.
      initApp({
        'parent/a/attachments/pic.png': 'PIC',
        'parent/a/drawing.excalidraw.md': 'EXCALIDRAW'
      }, './attachments');

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/attachments']);
    });
  });

  describe('AllFoldersRecursively', () => {
    it('should take every descendant folder, shallowest first', async () => {
      initApp({
        'parent/a/b/c/deepest.md': 'deepest',
        'parent/a/b/deep.md': 'deep',
        'parent/a/note.md': 'note'
      });

      // Shallowest-first IS the move order: `b` is promoted before `b/c`, and Obsidian's rename cascades,
      // So `c` is simply at its promoted parent's new path by the time its turn comes.
      expect(await collectPaths('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual([
        'parent/a/b',
        'parent/a/b/c'
      ]);
    });

    it('should leave every attachment folder with the notes it belongs to, at any depth (issue #171)', async () => {
      initApp({
        'parent/a/attachments/top.png': 'PIC',
        'parent/a/b/attachments/deep.png': 'PIC',
        'parent/a/b/c/other.md': 'other',
        'parent/a/b/deep.md': 'deep',
        'parent/a/note.md': 'note'
      }, './attachments');

      // `a/attachments` stays with `note.md`; `b` moves and carries `deep.md`, so `b/attachments` must not
      // Be promoted away from it; `b/c` is an ordinary folder and moves.
      expect(await collectPaths('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual([
        'parent/a/b',
        'parent/a/b/c'
      ]);
    });

    it('should not descend into a protected attachment folder', async () => {
      initApp({
        'parent/a/attachments/nested/pic.png': 'PIC',
        'parent/a/note.md': 'note'
      }, './attachments');

      // The attachment folder is left exactly as it is, contents included.
      expect(await collectPaths('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual([]);
    });
  });
});

/**
 * Issue #185: Obsidian builds a folder's context menu synchronously, so `canExecuteFolder` cannot await the
 * attachment resolution — which is why the two folder-only commands used to be offered even when the only
 * thing they could promote was an attachment folder. `obsidian-dev-utils`'
 * `getAttachmentFolderPathSyncOrNull` answers exactly whenever no attachment-location plugin installed its
 * own `extended` resolution, so the answer here is either identical to the asynchronous one or an honest
 * `null`.
 */
describe('collectFlattenItemsSyncOrNull', () => {
  it('should give the asynchronous collector\'s answer in every mode', async () => {
    initApp({
      'parent/a/attachments/pic.png': 'PIC',
      'parent/a/b/c/deepest.md': 'deepest',
      'parent/a/b/deep.md': 'deep',
      'parent/a/note.md': 'note'
    }, './attachments');

    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllChildren)).toStrictEqual(await collectPaths('parent/a', FlattenMode.AllChildren));
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly));
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual(
      await collectPaths('parent/a', FlattenMode.AllFoldersRecursively)
    );
  });

  it('should take nothing when the only child folder is the attachment folder (issue #185)', () => {
    initApp({
      'parent/a/attachments/pic.png': 'PIC',
      'parent/a/note.md': 'note'
    }, './attachments');

    expect(collectPathsSyncOrNull('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual([]);
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual([]);
  });

  it('should answer null for a folder-only mode once an attachment-location plugin owns the resolution', () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/note/pic.png': 'PIC'
    });
    stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));

    // Not "nothing to flatten" — "ask the asynchronous collector", which is what keeps the command offered.
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.ChildFoldersOnly)).toBeNull();
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllFoldersRecursively)).toBeNull();
  });

  it('should still answer AllChildren with an attachment-location plugin installed', () => {
    // `AllChildren` resolves no attachment folder at all, so nothing about it is asynchronous.
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/note/pic.png': 'PIC'
    });
    stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));

    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllChildren)?.sort()).toStrictEqual([
      'parent/a/note',
      'parent/a/note.md'
    ]);
  });
});
