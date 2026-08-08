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
   * Whether a path is excluded/ignored in the plugin settings — `PluginSettings.isPathIgnored`, injected as
   * a plain predicate so this module stays independent of the settings object.
   *
   * @param path - The path to check.
   * @returns Whether the path is excluded.
   */
  isPathIgnored(path: string): boolean;

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
 * Obsidian's own `attachmentFolderPath` setting, reduced to the two forms that can be recognized from a
 * FOLDER alone. Both are `null` for the two forms that cannot: the vault root (never a flatten candidate)
 * and the plain `.`/`./` mode, where every folder holding a note is its own attachment folder — recognizing
 * that would protect the entire vault, and the exact resolution correctly protects nothing there (see
 * {@link isProtectedFolder}).
 */
interface AttachmentFolderConfig {
  /**
   * The one folder every note's attachments resolve into (`Files`, `Docs/assets`), or `null` when the
   * setting is not an absolute path.
   */
  readonly absolutePath: null | string;

  /**
   * The FIRST segment of the subfolder appended to a note's own folder — `assets` for both `./assets` and
   * `./assets/deep` — or `null` when the setting is not note-relative. The first segment is what matters
   * because a candidate folder is a direct child of the folder holding the note, so it is that segment the
   * candidate has to be named after; the deeper segments live inside it and travel with it.
   */
  readonly relativeName: null | string;
}

/**
 * Everything the collectors need to decide whether a candidate folder must be left alone, other than the
 * attachment folders resolved per note (which only the folder-only modes know, and only sometimes
 * synchronously).
 */
interface FlattenContext {
  readonly attachmentExtensions: readonly string[];
  readonly attachmentFolderConfig: AttachmentFolderConfig;

  /**
   * Whether a path is excluded/ignored in the plugin settings.
   *
   * @param path - The path to check.
   * @returns Whether the path is excluded.
   */
  isPathIgnored(path: string): boolean;
}

/**
 * The parsed configuration that recognizes nothing — the vault root and the plain `.`/`./` mode both land
 * here.
 */
const NO_ATTACHMENT_FOLDER_CONFIG: AttachmentFolderConfig = { absolutePath: null, relativeName: null };

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
  return buildItems(folder, noteAttachmentFolders, mode, buildFlattenContext(params));
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
    folder,
    mode
  } = params;
  const context = buildFlattenContext(params);

  if (mode === FlattenMode.AllChildren) {
    /*
     * `filter` also snapshots, which this mode needs either way: renaming mutates `folder.children`
     * mid-iteration.
     *
     * Only the EXCLUSION applies here. The attachment rules — both `isProtectedFolder` and the configured
     * attachment folder — deliberately do not: this mode empties the folder, so no note stays behind for an
     * attachment folder to be kept beside, and the folder travels with its notes like any other child. An
     * excluded path is different in kind: the user said "do not touch this", which holds no matter what
     * moves around it.
     */
    return folder.children.filter((child) => !context.isPathIgnored(child.path));
  }

  /*
   * Both synchronous skips are applied BEFORE any attachment resolution, and that ordering is the whole
   * point: when nothing survives them there is nothing to flatten regardless of where attachments live, so
   * the answer is an exact `[]` even in a vault where the resolution is asynchronous. It is the only way
   * this function can answer at all once an attachment-location plugin owns the resolution.
   */
  if (!hasAnyCandidateFolder(folder, context)) {
    return [];
  }

  const noteAttachmentFolders = collectNoteAttachmentFoldersSyncOrNull(app, folder, context.attachmentExtensions);
  if (!noteAttachmentFolders) {
    return null;
  }

  return buildItems(folder, noteAttachmentFolders, mode, context);
}

function buildFlattenContext(params: CollectFlattenItemsParams): FlattenContext {
  return {
    attachmentExtensions: params.attachmentExtensions,
    attachmentFolderConfig: parseAttachmentFolderConfig(params.app),
    isPathIgnored: (path) => params.isPathIgnored(path)
  };
}

function buildItems(
  folder: TFolder,
  noteAttachmentFolders: readonly NoteAttachmentFolder[],
  mode: FlattenMode,
  context: FlattenContext
): TAbstractFile[] {
  const items: TAbstractFile[] = [];
  collectFolders(folder, noteAttachmentFolders, mode === FlattenMode.AllFoldersRecursively, context, items);
  return items;
}

function collectFolders(
  folder: TFolder,
  noteAttachmentFolders: readonly NoteAttachmentFolder[],
  isRecursive: boolean,
  context: FlattenContext,
  items: TAbstractFile[]
): void {
  for (const child of folder.children) {
    if (!isFolder(child)) {
      continue;
    }
    if (isSkippedFolder(child, context) || isProtectedFolder(child, noteAttachmentFolders)) {
      // An attachment folder is left exactly as it is, contents included — promoting something out of it
      // Would scatter the very attachments the mode exists to keep together. The same goes, subtree
      // Included, for a folder the user excluded.
      continue;
    }
    items.push(child);
    if (isRecursive) {
      collectFolders(child, noteAttachmentFolders, isRecursive, context, items);
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

/**
 * Walks the whole subtree, deliberately WITHOUT skipping excluded folders. Exclusion says "do not move
 * this"; an attachment folder resolved from an excluded note is still an attachment folder, and dropping it
 * here would UNPROTECT a candidate and let a flatten separate that note from its attachments. The two rules
 * are a union, not alternatives.
 *
 * @param folder - The folder being flattened.
 * @param attachmentExtensions - The extensions that make a markdown file an attachment rather than a note.
 * @param noteFiles - Collects the notes found.
 */
function collectNotes(folder: TFolder, attachmentExtensions: readonly string[], noteFiles: TFile[]): void {
  for (const child of folder.children) {
    if (isFolder(child)) {
      collectNotes(child, attachmentExtensions, noteFiles);
      continue;
    }
    if (isNote(child, attachmentExtensions)) {
      noteFiles.push(child);
    }
  }
}

/**
 * Whether anything under the folder could still move once the two SYNCHRONOUS skips have been applied.
 *
 * Only the direct children are examined, and that covers the recursive mode too: a skipped folder takes its
 * whole subtree with it, so when every direct child folder is skipped there is no candidate at any depth
 * either. {@link isProtectedFolder} can only remove more, never add, which is what makes a `false` here a
 * sound answer without resolving a single attachment folder.
 *
 * @param folder - The folder being flattened.
 * @param context - The exclusion predicate and the configured attachment folder.
 * @returns Whether a folder-only mode has any candidate left to consider.
 */
function hasAnyCandidateFolder(folder: TFolder, context: FlattenContext): boolean {
  return folder.children.some((child) => isFolder(child) && !isSkippedFolder(child, context));
}

/**
 * Whether the folder holds a note of its own — the discriminator {@link isConfiguredAttachmentFolder} needs,
 * because a note-relative attachment folder only belongs to the notes sitting NEXT to it.
 *
 * @param folder - The folder to look in.
 * @param attachmentExtensions - The extensions that make a markdown file an attachment rather than a note.
 * @returns Whether any direct child is a note.
 */
function hasOwnNote(folder: TFolder, attachmentExtensions: readonly string[]): boolean {
  return folder.children.some((child) => !isFolder(child) && isNote(child, attachmentExtensions));
}

/**
 * Whether Obsidian's own `attachmentFolderPath` says this folder is where attachments go — the best-effort
 * second opinion next to {@link isProtectedFolder}'s exact one.
 *
 * It earns its place twice over. It is the ONLY signal available synchronously once an attachment-location
 * plugin owns the resolution (issue #193), and it catches a case the exact resolution structurally cannot:
 * {@link collectNoteAttachmentFolders} only walks notes UNDER the flattened folder, so a fixed attachment
 * folder that happens to sit inside it, serving notes elsewhere in the vault, resolves for nobody and would
 * otherwise be promoted.
 *
 * It is best-effort by construction and cannot be otherwise — an attachment-location plugin derives the
 * folder from the note through a template that may include a UUID, a random value or a user prompt, so
 * there is no inverse to compute. `Exclude paths` is what covers those vaults.
 *
 * @param folder - The candidate folder.
 * @param context - The exclusion predicate and the configured attachment folder.
 * @returns Whether the folder matches the configured attachment folder.
 */
function isConfiguredAttachmentFolder(folder: TFolder, context: FlattenContext): boolean {
  const { absolutePath, relativeName } = context.attachmentFolderConfig;

  if (absolutePath !== null) {
    // Ancestor-or-self, matching `isProtectedFolder`: promoting `Docs` separates `Docs/assets` from every
    // Note in the vault just as surely as promoting `Docs/assets` itself would.
    return isInsideOrEqualIgnoreCase(absolutePath, folder.path);
  }

  if (folder.name.toLowerCase() !== relativeName?.toLowerCase()) {
    return false;
  }

  // A note-relative attachment folder belongs to the notes beside it. With no note staying behind in the
  // Parent there is nothing to be separated from, and an unrelated folder that merely shares the configured
  // Name keeps flattening normally.
  const parentFolder = folder.parent;
  /* v8 ignore start -- a non-root folder always has a parent. */
  if (!parentFolder) {
    return false;
  }
  /* v8 ignore stop */
  return hasOwnNote(parentFolder, context.attachmentExtensions);
}

function isInsideOrEqual(path: string, folderPath: string): boolean {
  return path === folderPath || path.startsWith(`${folderPath}/`);
}

/**
 * {@link isInsideOrEqual}, case-insensitively — `obsidian-dev-utils` resolves the configured folder with
 * `getFolderOrNull({ isCaseInsensitive: true })`, so a case-sensitive compare here would disagree with the
 * resolution it is standing in for.
 *
 * @param path - The path to test.
 * @param folderPath - The folder it may sit inside.
 * @returns Whether the path is inside or equal to the folder.
 */
function isInsideOrEqualIgnoreCase(path: string, folderPath: string): boolean {
  return isInsideOrEqual(path.toLowerCase(), folderPath.toLowerCase());
}

/**
 * The markdown gate stays paired with the configured extensions, exactly as `attachments.ts` pairs them: a
 * markdown-shaped attachment (`.excalidraw.md`) is not a note and owns no attachment folder.
 *
 * @param file - The file to classify.
 * @param attachmentExtensions - The extensions that make a markdown file an attachment rather than a note.
 * @returns Whether the file is a note.
 */
function isNote(file: TAbstractFile, attachmentExtensions: readonly string[]): file is TFile {
  return isFile(file) && isMarkdownFile(file) && !isTreatedAsAttachment({ attachmentExtensions, pathOrFile: file });
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
 * It is EXACT but not complete, which is why {@link isConfiguredAttachmentFolder} sits beside it: the notes
 * it resolves are only the ones under the flattened folder, and it needs an answer the vault may only be
 * able to give asynchronously.
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

/**
 * The two skips that need no attachment resolution: the user excluded the folder, or Obsidian's own
 * `attachmentFolderPath` says it is an attachment folder.
 *
 * @param folder - The candidate folder.
 * @param context - The exclusion predicate and the configured attachment folder.
 * @returns Whether the folder must be left where it is, subtree included.
 */
function isSkippedFolder(folder: TFolder, context: FlattenContext): boolean {
  return context.isPathIgnored(folder.path) || isConfiguredAttachmentFolder(folder, context);
}

/**
 * Reduces Obsidian's `attachmentFolderPath` setting to the two forms recognizable from a folder alone,
 * following the same branching `obsidian-dev-utils` `resolveAttachmentFolder` uses to resolve it forwards.
 *
 * `/` (and the empty value) is the vault root, which is never a flatten candidate; `.`/`./` puts every
 * note's attachments in its own folder, so recognizing it would protect every folder in the vault. Both
 * therefore parse to "recognizes nothing" rather than to a rule — and the exact resolution already protects
 * nothing in either case (see {@link isProtectedFolder}), so nothing is lost.
 *
 * @param app - The Obsidian application instance.
 * @returns The parsed configuration.
 */
function parseAttachmentFolderConfig(app: App): AttachmentFolderConfig {
  const raw = app.vault.getConfig('attachmentFolderPath') as string | undefined;

  // An unset value is the vault root too — Obsidian always writes the key, but `obsidian-dev-utils` reads it
  // Without a fallback, so absorbing it here rather than propagating `undefined` costs nothing.
  if (!raw || raw === '/' || raw === '.') {
    return NO_ATTACHMENT_FOLDER_CONFIG;
  }

  if (raw.startsWith('./')) {
    // Only the FIRST segment: a candidate is a direct child of the folder holding the note, so `./a/b` makes
    // `a` the folder that must stay — `b` lives inside it and travels with it. A bare `./` leaves nothing to
    // Name, which is the plain "beside the note" mode.
    const relativeName = raw.slice('./'.length).split('/', 1)[0];
    return relativeName ? { absolutePath: null, relativeName } : NO_ATTACHMENT_FOLDER_CONFIG;
  }

  return { absolutePath: raw, relativeName: null };
}
