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
  collectFlattenItemsSyncOrNull,
  isFlattenModeDistinct
} from './flatten-items.ts';
import { FlattenMode } from './plugin-settings.ts';

const ATTACHMENT_EXTENSIONS = ['.excalidraw.md'];

let app: AppOriginal;
let excludedPaths: string[] = [];

async function collectPaths(folderPath: string, mode: FlattenMode): Promise<string[]> {
  const items = await collectFlattenItems({
    app,
    attachmentExtensions: ATTACHMENT_EXTENSIONS,
    folder: getFolder(folderPath),
    isPathIgnored,
    mode
  });
  return items.map((item) => item.path);
}

function collectPathsSyncOrNull(folderPath: string, mode: FlattenMode): null | string[] {
  const items = collectFlattenItemsSyncOrNull({
    app,
    attachmentExtensions: ATTACHMENT_EXTENSIONS,
    folder: getFolder(folderPath),
    isPathIgnored,
    mode
  });
  return items?.map((item) => item.path) ?? null;
}

/**
 * Stands in for `PluginSettings.isPathIgnored`, matching the path and its whole subtree exactly as ODU's
 * `PathSettings` compiles a plain path entry (`^<escaped>(/|$)`).
 *
 * @param paths - The excluded paths.
 */
function excludePaths(...paths: string[]): void {
  excludedPaths = paths;
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>, attachmentFolderPath = './'): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  app.vault.setConfig('attachmentFolderPath', attachmentFolderPath);
  excludedPaths = [];
}

/**
 * Asks {@link isFlattenModeDistinct} about a folder, collecting the mode's items first exactly as
 * `canExecuteFolder` does.
 *
 * @param folderPath - The folder being flattened.
 * @param mode - The mode to judge.
 * @returns Whether the mode moves something a simpler one would not.
 */
function isDistinct(folderPath: string, mode: FlattenMode): boolean {
  const folder = getFolder(folderPath);
  const items = ensureNonNullable(collectFlattenItemsSyncOrNull({
    app,
    attachmentExtensions: ATTACHMENT_EXTENSIONS,
    folder,
    isPathIgnored,
    mode
  }));
  return isFlattenModeDistinct({
    app,
    attachmentExtensions: ATTACHMENT_EXTENSIONS,
    folder,
    isPathIgnored,
    items,
    mode
  });
}

function isPathIgnored(path: string): boolean {
  return excludedPaths.some((excludedPath) => path === excludedPath || path.startsWith(`${excludedPath}/`));
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

/**
 * Issue #193: excluding a path used to gate only the commands run ON it, never the items a flatten MOVES, so
 * a user who excluded their attachment folder still saw it promoted out of its parent. Exclusion now means
 * the same thing here as it already did for the merges (`isMergeIgnored`) — the plugin does not move it.
 *
 * Being a plain synchronous predicate is what makes it the answer for a vault where an attachment-location
 * plugin owns the resolution: it is decidable exactly when nothing else is.
 */
describe('excluded paths', () => {
  it('should not move an excluded child in any mode', async () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    });
    excludePaths('parent/a/assets');

    const allChildrenPaths = await collectPaths('parent/a', FlattenMode.AllChildren);
    expect(allChildrenPaths.sort()).toStrictEqual([
      'parent/a/note.md',
      'parent/a/sub'
    ]);
    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    expect(await collectPaths('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual(['parent/a/sub']);
  });

  it('should skip an excluded folder\'s whole subtree', async () => {
    initApp({
      'parent/a/assets/nested/pic.png': 'PIC',
      'parent/a/note.md': 'note'
    });
    excludePaths('parent/a/assets');

    // `nested` is never promoted either — the excluded folder is left exactly as it is, contents included.
    expect(await collectPaths('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual([]);
  });

  it('should answer an exact empty list, not null, when everything is excluded under an attachment-location plugin', () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/note.md': 'note'
    });
    stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));
    excludePaths('parent/a/assets');

    // The whole point of testing exclusion BEFORE resolving: this is the reporter's vault, and the answer
    // Here is what hides the command instead of offering one that would do nothing.
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual([]);
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllFoldersRecursively)).toStrictEqual([]);
  });

  it('should still answer null under an attachment-location plugin while a non-excluded candidate remains', () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    });
    stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));
    excludePaths('parent/a/assets');

    expect(collectPathsSyncOrNull('parent/a', FlattenMode.ChildFoldersOnly)).toBeNull();
  });

  it('should still protect the attachment folder of an EXCLUDED note', async () => {
    initApp({
      'parent/a/attachments/pic.png': 'PIC',
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    }, './attachments');
    excludePaths('parent/a/note.md');

    // Exclusion says "do not move this", not "this note has no attachments": dropping an excluded note from
    // The resolution would UNPROTECT `attachments` and scatter the very files the note still owns.
    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
  });
});

/**
 * Issue #193: Obsidian's own `attachmentFolderPath` is a second, best-effort opinion next to the exact
 * resolution — the only one available synchronously once an attachment-location plugin owns the resolution,
 * and the only one at all for a fixed attachment folder whose notes live outside the flattened folder.
 */
describe('configured attachment folder', () => {
  it('should protect a fixed attachment folder no note under the flattened folder resolves into', async () => {
    initApp({
      'other/note.md': 'note',
      'parent/a/Files/pic.png': 'PIC',
      'parent/a/sub/pic.png': 'PIC'
    }, 'parent/a/Files');

    // Nothing under `parent/a` is a note, so the exact resolution has no entry to protect `Files` with — it
    // Only ever walks notes INSIDE the flattened folder. The configured path is what catches it.
    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
  });

  it('should protect a child folder that merely CONTAINS the fixed attachment folder', async () => {
    initApp({
      'parent/a/sub/pic.png': 'PIC',
      'parent/a/x/assets/pic.png': 'PIC'
    }, 'parent/a/x/assets');

    // Promoting `x` separates `x/assets` from every note in the vault just as surely as promoting the
    // Attachment folder itself would.
    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
  });

  it('should match a fixed attachment folder case-insensitively', async () => {
    initApp({
      'parent/a/files/pic.png': 'PIC',
      'parent/a/sub/pic.png': 'PIC'
    }, 'parent/a/FILES');

    // `obsidian-dev-utils` resolves the configured folder case-insensitively, so this has to agree with it.
    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
  });

  it('should match a note-relative attachment folder by name, case-insensitively', async () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    }, './Assets');

    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
  });

  it('should not protect a folder that only shares the configured name beside no note', async () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/pic.png': 'PIC'
    }, './assets');

    // A note-relative attachment folder belongs to the notes NEXT to it. With none staying behind there is
    // Nothing to be separated from, so an unrelated folder of that name keeps flattening.
    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/assets']);
  });

  it('should protect nothing when attachments go to the vault root', async () => {
    for (const attachmentFolderPath of ['', '/', '.']) {
      initApp({
        'parent/a/note.md': 'note',
        'parent/a/sub/deep.md': 'deep'
      }, attachmentFolderPath);

      expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
    }
  });

  it('should ignore the vault\'s own setting under an attachment-location plugin', () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/note.md': 'note'
    }, './assets');
    stubAttachmentLocationPlugin((notePath) => notePath.replace(/\.md$/, ''));

    /*
     * This used to answer an exact `[]` off `attachmentFolderPath` alone. Issue #213 is why it no longer
     * does: the plugin owning the resolution also owns that setting, so reading it answers a question
     * nobody asked. `null` is the honest answer — resolve asynchronously and offer the command meanwhile.
     */
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.ChildFoldersOnly)).toBeNull();
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllFoldersRecursively)).toBeNull();
  });

  it('should not mistake a candidate folder for the attachment folder when a plugin parks its own path in the setting (issue #213)', () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    });
    stubAttachmentLocationPlugin((notePath) => `${notePath.replace(/\/[^/]+$/, '')}/@`);
    /*
     * Custom Attachment Location keeps `attachmentFolderPath` pointed at the folder it last resolved for
     * the ACTIVE note — an absolute path, and after `Create folder with notes...` that path sits inside the
     * folder just created. Read as a setting it made `isConfiguredAttachmentFolder` claim `parent/a/sub`,
     * and its every ancestor, as an attachment folder, so both folder-only variants vanished from the menu.
     */
    app.vault.setConfig('attachmentFolderPath', 'parent/a/sub/@');

    expect(collectPathsSyncOrNull('parent/a', FlattenMode.ChildFoldersOnly)).toBeNull();
    expect(collectPathsSyncOrNull('parent/a', FlattenMode.AllFoldersRecursively)).toBeNull();
  });

  it('should promote the folder the parked path pointed at, once resolved asynchronously (issue #213)', async () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    });
    stubAttachmentLocationPlugin((notePath) => `${notePath.replace(/\/[^/]+$/, '')}/@`);
    app.vault.setConfig('attachmentFolderPath', 'parent/a/sub/@');

    // The exact per-note resolution keeps `sub` promotable: its own note travels inside it, so nothing is
    // Separated from its attachments. Offering the command was therefore right, not merely permissive.
    expect(await collectPaths('parent/a', FlattenMode.ChildFoldersOnly)).toStrictEqual(['parent/a/sub']);
  });

  it('should give the same answer synchronously and asynchronously', async () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    }, './assets');
    excludePaths('parent/a/sub');

    // The menu and the executor read the same collector, so they can never disagree about what would move.
    for (const mode of [FlattenMode.AllChildren, FlattenMode.ChildFoldersOnly, FlattenMode.AllFoldersRecursively]) {
      expect(collectPathsSyncOrNull('parent/a', mode)).toStrictEqual(await collectPaths('parent/a', mode));
    }
  });
});

/**
 * Issue #210: a variant is only worth offering where it moves something a simpler variant would not. The
 * pairing is per-mode — recursive against child-folders-only, child-folders-only against all-children — and
 * the answer comes from what would ACTUALLY move, not from the shape of the tree.
 */
describe('isFlattenModeDistinct', () => {
  it('should always call AllChildren distinct, since nothing is simpler', () => {
    initApp({ 'parent/a/sub/deep.md': 'deep' });

    expect(isDistinct('parent/a', FlattenMode.AllChildren)).toBe(true);
  });

  it('should call ChildFoldersOnly a duplicate when the folder holds nothing but folders', () => {
    initApp({ 'parent/a/sub/deep.md': 'deep' });

    // Both modes move `parent/a/sub` and nothing else, so the second entry only repeats the first.
    expect(isDistinct('parent/a', FlattenMode.ChildFoldersOnly)).toBe(false);
  });

  it('should call ChildFoldersOnly distinct when a file of the folder stays behind', () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    });

    // `AllChildren` would take the note too — leaving it is exactly what this mode is for.
    expect(isDistinct('parent/a', FlattenMode.ChildFoldersOnly)).toBe(true);
  });

  it('should call ChildFoldersOnly distinct when a child folder is left behind as an attachment folder', () => {
    initApp({
      'parent/a/assets/pic.png': 'PIC',
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    }, './assets');

    expect(isDistinct('parent/a', FlattenMode.ChildFoldersOnly)).toBe(true);
  });

  it('should call AllFoldersRecursively a duplicate when no child folder holds a folder of its own', () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    });

    // The reported case: there is a folder to promote, but nothing nested under it, so the recursive
    // Variant can only repeat `ChildFoldersOnly`.
    expect(isDistinct('parent/a', FlattenMode.AllFoldersRecursively)).toBe(false);
  });

  it('should call AllFoldersRecursively distinct when a child folder holds a folder of its own', () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/sub/deeper/deepest.md': 'deepest'
    });

    expect(isDistinct('parent/a', FlattenMode.AllFoldersRecursively)).toBe(true);
  });

  it('should judge the recursive mode by what would move, not by the shape of the tree', () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep',
      'parent/a/sub/hidden/buried.md': 'buried'
    });
    excludePaths('parent/a/sub/hidden');

    // The tree IS nested, but the only nested folder is excluded, so the recursive mode would move exactly
    // What `ChildFoldersOnly` moves.
    expect(isDistinct('parent/a', FlattenMode.AllFoldersRecursively)).toBe(false);
  });

  it('should keep the recursive mode distinct even when ChildFoldersOnly is itself a duplicate', () => {
    initApp({ 'parent/a/sub/deeper/deepest.md': 'deepest' });

    // A folder of folders only: `ChildFoldersOnly` repeats `Flatten folder...` and drops out, while the
    // Recursive variant still promotes the nested folder neither of them would.
    expect(isDistinct('parent/a', FlattenMode.ChildFoldersOnly)).toBe(false);
    expect(isDistinct('parent/a', FlattenMode.AllFoldersRecursively)).toBe(true);
  });

  it('should ignore an excluded child on both sides of the comparison', () => {
    initApp({
      'parent/a/hidden/buried.md': 'buried',
      'parent/a/sub/deep.md': 'deep'
    });
    excludePaths('parent/a/hidden');

    // The excluded folder is dropped by both modes, so it cannot make them look different.
    expect(isDistinct('parent/a', FlattenMode.ChildFoldersOnly)).toBe(false);
  });
});
