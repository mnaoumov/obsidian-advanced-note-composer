import type {
  App,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';

import {
  getAttachmentFolderPath,
  getAttachmentFolderPathSyncOrNull
} from 'obsidian-dev-utils/obsidian/attachment-path';
import {
  isFile,
  isFolder,
  isMarkdownFile,
  isTreatedAsAttachment
} from 'obsidian-dev-utils/obsidian/file-system';

import { FlattenMode } from './plugin-settings.ts';

/**
 * Parameters for {@link collectFlattenItems}.
 */
export interface CollectFlattenItemsParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The configured extensions that make a file an attachment, e.g. `['.excalidraw.md']`. A markdown file
   * matching one of them is an attachment, not a note, so it never gets an attachment folder of its own.
   */
  readonly attachmentExtensions: readonly string[];

  /**
   * The folder being flattened.
   */
  readonly folder: TFolder;

  /**
   * What the flatten promotes.
   */
  readonly mode: FlattenMode;
}

/**
 * Parameters for {@link collectFlattenItemsSyncOrNull} — the same question as
 * {@link CollectFlattenItemsParams}, asked synchronously.
 */
export type CollectFlattenItemsSyncOrNullParams = CollectFlattenItemsParams;

/**
 * One note in the flattened folder's subtree, paired with the folder its attachments belong in.
 */
interface NoteAttachmentFolder {
  readonly attachmentFolderPath: string;
  readonly notePath: string;
}

/**
 * Decides what a flatten actually moves — the single owner of that question, so the executor, the
 * confirmation preview and `canExecuteFolder` cannot drift apart.
 *
 * `AllChildren` is the original behavior verbatim: every direct child, in `folder.children` order, with no
 * attachment resolution at all. The folder-only modes ({@link FlattenMode.ChildFoldersOnly},
 * {@link FlattenMode.AllFoldersRecursively}, issues #170/#171) walk the folder top-down and collect its
 * sub-folders, skipping the ones that hold somebody else's attachments (see
 * {@link collectProtectedFolderPaths}) together with their whole subtree.
 *
 * The result is in move order, shallowest first. That matters for the recursive mode: each rename targets
 * `<parent>/<name>` off the live {@link TAbstractFile}, and Obsidian's rename cascades to descendants, so
 * promoting `A/b` before `A/b/c` is fine — `c` simply sits at `parent/b/c` by the time its turn comes.
 *
 * @param params - The parameters.
 * @returns The files and folders the flatten will move, in the order it will move them.
 */
export async function collectFlattenItems(params: CollectFlattenItemsParams): Promise<TAbstractFile[]> {
  const syncItems = collectFlattenItemsSyncOrNull(params);
  if (syncItems) {
    return syncItems;
  }

  const {
    app,
    attachmentExtensions,
    folder,
    mode
  } = params;
  const noteAttachmentFolders = await collectNoteAttachmentFolders(app, folder, attachmentExtensions);
  return buildItems(folder, noteAttachmentFolders, mode);
}

/**
 * The synchronous twin of {@link collectFlattenItems}, for callers that cannot await — Obsidian builds a
 * folder's context menu and evaluates a command's `checkCallback` synchronously, so `canExecuteFolder`
 * deciding whether to merely OFFER a flatten has no chance to resolve attachment folders (issue #185).
 *
 * `null` means "ask {@link collectFlattenItems}", never "nothing to flatten": a folder-only mode has to know
 * where every note's attachments belong, and once an attachment-location plugin (Custom Attachment Location
 * and friends) installs its own resolution, that answer is genuinely asynchronous. Otherwise the answer is
 * exact rather than a guess — `obsidian-dev-utils`' {@link getAttachmentFolderPathSyncOrNull} runs the very
 * code {@link getAttachmentFolderPath} would have run.
 *
 * {@link FlattenMode.AllChildren} resolves no attachment folder at all, so it never answers `null`.
 *
 * @param params - The parameters.
 * @returns The files and folders the flatten will move, or `null` when that is only knowable
 * asynchronously.
 */
export function collectFlattenItemsSyncOrNull(params: CollectFlattenItemsSyncOrNullParams): null | TAbstractFile[] {
  const {
    app,
    attachmentExtensions,
    folder,
    mode
  } = params;

  if (mode === FlattenMode.AllChildren) {
    // Snapshot: renaming mutates `folder.children` mid-iteration.
    return [...folder.children];
  }

  const noteAttachmentFolders = collectNoteAttachmentFoldersSyncOrNull(app, folder, attachmentExtensions);
  if (!noteAttachmentFolders) {
    return null;
  }

  return buildItems(folder, noteAttachmentFolders, mode);
}

function buildItems(folder: TFolder, noteAttachmentFolders: readonly NoteAttachmentFolder[], mode: FlattenMode): TAbstractFile[] {
  const items: TAbstractFile[] = [];
  collectFolders(folder, noteAttachmentFolders, mode === FlattenMode.AllFoldersRecursively, items);
  return items;
}

function collectFolders(
  folder: TFolder,
  noteAttachmentFolders: readonly NoteAttachmentFolder[],
  isRecursive: boolean,
  items: TAbstractFile[]
): void {
  for (const child of folder.children) {
    if (!isFolder(child)) {
      continue;
    }
    if (isProtectedFolder(child, noteAttachmentFolders)) {
      // An attachment folder is left exactly as it is, contents included — promoting something out of it
      // Would scatter the very attachments the mode exists to keep together.
      continue;
    }
    items.push(child);
    if (isRecursive) {
      collectFolders(child, noteAttachmentFolders, isRecursive, items);
    }
  }
}

/**
 * Resolves, for every note under the folder, where its attachments belong. The resolution goes through
 * `obsidian-dev-utils` {@link getAttachmentFolderPath} — the surface Custom Attachment Location patches —
 * so a vault running that plugin is answered correctly without this plugin knowing it exists (issue #161).
 *
 * @param app - The Obsidian application instance.
 * @param folder - The folder being flattened.
 * @param attachmentExtensions - The extensions that make a markdown file an attachment rather than a note.
 * @returns One entry per note in the subtree.
 */
async function collectNoteAttachmentFolders(
  app: App,
  folder: TFolder,
  attachmentExtensions: readonly string[]
): Promise<NoteAttachmentFolder[]> {
  const noteFiles: TFile[] = [];
  collectNotes(folder, attachmentExtensions, noteFiles);

  const noteAttachmentFolders: NoteAttachmentFolder[] = [];
  for (const noteFile of noteFiles) {
    const attachmentFolderPath = await getAttachmentFolderPath({ app, notePathOrFile: noteFile });
    noteAttachmentFolders.push({ attachmentFolderPath, notePath: noteFile.path });
  }
  return noteAttachmentFolders;
}

/**
 * The synchronous twin of {@link collectNoteAttachmentFolders}, answering `null` the moment one note's
 * folder is only knowable asynchronously — which is a property of the vault, not of the note, so the first
 * `null` is also the last word.
 *
 * @param app - The Obsidian application instance.
 * @param folder - The folder being flattened.
 * @param attachmentExtensions - The extensions that make a markdown file an attachment rather than a note.
 * @returns One entry per note in the subtree, or `null` when the resolution is asynchronous.
 */
function collectNoteAttachmentFoldersSyncOrNull(
  app: App,
  folder: TFolder,
  attachmentExtensions: readonly string[]
): NoteAttachmentFolder[] | null {
  const noteFiles: TFile[] = [];
  collectNotes(folder, attachmentExtensions, noteFiles);

  const noteAttachmentFolders: NoteAttachmentFolder[] = [];
  for (const noteFile of noteFiles) {
    const attachmentFolderPath = getAttachmentFolderPathSyncOrNull({ app, notePathOrFile: noteFile });
    if (attachmentFolderPath === null) {
      return null;
    }
    noteAttachmentFolders.push({ attachmentFolderPath, notePath: noteFile.path });
  }
  return noteAttachmentFolders;
}

function collectNotes(folder: TFolder, attachmentExtensions: readonly string[], noteFiles: TFile[]): void {
  for (const child of folder.children) {
    if (isFolder(child)) {
      collectNotes(child, attachmentExtensions, noteFiles);
      continue;
    }
    // The markdown gate stays paired with the configured extensions, exactly as `attachments.ts` pairs
    // Them: a markdown-shaped attachment (`.excalidraw.md`) is not a note and owns no attachment folder.
    if (isFile(child) && isMarkdownFile(child) && !isTreatedAsAttachment({ attachmentExtensions, pathOrFile: child })) {
      noteFiles.push(child);
    }
  }
}

function isInsideOrEqual(path: string, folderPath: string): boolean {
  return path === folderPath || path.startsWith(`${folderPath}/`);
}

/**
 * Answers issue #170's "except the attachment folder" without ever asking which folder is *named* like an
 * attachment folder: a candidate is protected exactly when moving it would separate a note from its
 * attachments — some note's attachment folder lies inside it while the note itself does not.
 *
 * That one predicate covers both folder modes:
 *
 * - `A/attachments`, holding `A/note.md`'s attachments, is protected: the note stays behind.
 * - `A/b`, holding both `A/b/note.md` and its `A/b/att`, is NOT protected: the note travels inside it.
 * - `A/b/att` IS protected under the recursive mode, so it is not promoted away from `A/b/note.md`.
 * - An attachment folder resolving outside the flattened folder (the vault root, a fixed folder) or onto
 *   the note's own folder (the plain `./` mode) protects nothing — there is no candidate containing it.
 *
 * Deliberately NOT `obsidian-dev-utils` `hasOwnAttachmentFolder`: that compares a note's attachment folder
 * against one resolved for a non-existent dummy note, so it answers `true` for the plain `./` mode too.
 *
 * @param folder - The candidate folder.
 * @param noteAttachmentFolders - Every note in the subtree with the folder its attachments belong in.
 * @returns Whether the folder must be left where it is.
 */
function isProtectedFolder(folder: TFolder, noteAttachmentFolders: readonly NoteAttachmentFolder[]): boolean {
  return noteAttachmentFolders.some((noteAttachmentFolder) =>
    isInsideOrEqual(noteAttachmentFolder.attachmentFolderPath, folder.path)
    && !isInsideOrEqual(noteAttachmentFolder.notePath, folder.path)
  );
}
