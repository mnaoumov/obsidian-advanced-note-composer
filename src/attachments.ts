import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import { Vault } from 'obsidian';
import {
  AttachmentPathContext,
  getAttachmentFilePath,
  isAtProperAttachmentPath
} from 'obsidian-dev-utils/obsidian/attachment-path';
import {
  isFile,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/file-system';

/**
 * One attachment move: where it is, which note it came from, and which note it now belongs to.
 */
export interface AttachmentRelocation {
  /**
   * The attachment to move.
   */
  readonly attachment: TFile;

  /**
   * The note the attachment now belongs to; its attachment folder is the destination.
   */
  readonly newNoteFile: TFile;

  /**
   * The note the attachment used to belong to. Passed through so an attachment-location plugin can see
   * the full before/after picture.
   */
  readonly oldNoteFile: TFile;
}

/**
 * One attachment about to move, and the note it belongs to.
 */
export interface AttachmentToRelocate {
  /**
   * The attachment file itself.
   */
  readonly file: TFile;

  /**
   * The note the attachment belongs to: the first note that references it, or — for an unreferenced
   * file — the note at whose proper attachment path it already sits.
   */
  readonly ownerNoteFile: TFile;
}

/**
 * Parameters for {@link collectAttachmentsOwnedByNote}.
 */
export interface CollectAttachmentsOwnedByNoteParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The configured sub-extensions that make a markdown file an attachment, e.g. `['excalidraw']`.
   */
  readonly markdownAttachmentSubExtensions: readonly string[];

  /**
   * The note whose attachments are collected.
   */
  readonly noteFile: TFile;
}

/**
 * Parameters for {@link collectAttachmentsToRelocate}.
 */
export interface CollectAttachmentsToRelocateParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The folder whose attachments are collected. Only its descendants are considered — an attachment
   * already living outside it is not this operation's business.
   */
  readonly folder: TFolder;

  /**
   * The notes being merged/moved. Everything else under the folder is a candidate attachment.
   */
  readonly noteFiles: readonly TFile[];
}

/**
 * Parameters for {@link isMarkdownAttachment}.
 */
export interface IsMarkdownAttachmentParams {
  /**
   * The file to classify.
   */
  readonly file: TFile;

  /**
   * The configured sub-extensions, e.g. `['excalidraw']`.
   */
  readonly markdownAttachmentSubExtensions: readonly string[];
}

/**
 * Parameters for {@link relocateAttachments}.
 */
export interface RelocateAttachmentsParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The moves to perform.
   */
  readonly relocations: readonly AttachmentRelocation[];

  /**
   * The transaction to route the renames through, so they are reversed if the operation is cancelled.
   */
  readonly vaultTransaction: VaultTransaction;
}

/**
 * Parameters for {@link resolveAttachmentDestination}.
 */
export interface ResolveAttachmentDestinationParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The attachment being relocated.
   */
  readonly attachment: TFile;

  /**
   * The note the attachment now belongs to.
   */
  readonly newNoteFile: TFile;

  /**
   * The note the attachment used to belong to.
   */
  readonly oldNoteFile: TFile;
}

/**
 * Collects the attachments a single note owns, so a file-level merge can carry them into the target
 * note's attachment folder (issue #161). A note is "the owner" of an attachment when
 *
 * the note references it (the metadata cache's resolved links, which cover embeds) and NO other note
 * does — a shared attachment belongs to no single note, so moving it with one of them would drag it away
 * from the others.
 *
 * Links to ordinary notes are never collected; a markdown file that is really an attachment
 * ({@link isMarkdownAttachment}) is.
 *
 * Deliberately narrower than {@link collectAttachmentsToRelocate}, which ALSO takes unreferenced files
 * sitting at a proper attachment path: that rule is only safe because a folder merge is moving the whole
 * folder anyway. A single note shares its folder with its neighbors, so the same rule would drag files
 * that have nothing to do with it. An unreferenced stray in a per-note attachment folder is therefore
 * left behind — the cost of never touching a file the merged note does not point at.
 *
 * @param params - The note, the app, and the markdown-attachment sub-extensions.
 * @returns The attachments to relocate with their owning note, in path order.
 */
export function collectAttachmentsOwnedByNote(params: CollectAttachmentsOwnedByNoteParams): AttachmentToRelocate[] {
  const { app, markdownAttachmentSubExtensions, noteFile } = params;

  const candidates = new Map<string, TFile>();
  /* v8 ignore next -- defensive ?? for a note the metadata cache has not indexed yet. */
  for (const linkPath of Object.keys(app.metadataCache.resolvedLinks[noteFile.path] ?? {})) {
    const linkedFile = app.vault.getFileByPath(linkPath);
    if (linkedFile && isAttachmentFile(linkedFile, markdownAttachmentSubExtensions)) {
      candidates.set(linkedFile.path, linkedFile);
    }
  }

  const pathsReferencedByOtherNotes = collectPathsReferencedByOtherNotes(app, noteFile);
  const attachments: AttachmentToRelocate[] = [];
  for (const candidate of candidates.values()) {
    if (pathsReferencedByOtherNotes.has(candidate.path)) {
      continue;
    }
    attachments.push({ file: candidate, ownerNoteFile: noteFile });
  }

  return attachments.sort((a, b) => a.file.path.localeCompare(b.file.path));
}

/**
 * Collects the attachments a folder operation should carry along (issue #160 item 3, issue #161): every
 * descendant of the folder that is NOT one of the notes being merged/moved and that is either
 *
 * - referenced by one of those notes (via the metadata cache's resolved links, which cover embeds), or
 * - unreferenced but already sitting at its proper attachment path for one of them, as decided by
 *   `obsidian-dev-utils` {@link isAtProperAttachmentPath} — a stray in an attachment folder is still an
 *   attachment, and leaving it behind would keep its folder alive.
 *
 * Only notes whose own folder contains the attachment's folder are consulted for the second rule, which
 * is what "its attachment folder" means for every attachment-folder mode Obsidian offers (beside the
 * note, a relative sub-folder of the note's folder, the vault root, or a fixed folder — the last two
 * resolve outside the merged folder, so nothing under it matches them).
 *
 * @param params - The folder, the notes, and the app.
 * @returns The attachments to relocate with their owning notes, in path order.
 */
export async function collectAttachmentsToRelocate(params: CollectAttachmentsToRelocateParams): Promise<AttachmentToRelocate[]> {
  const { app, folder, noteFiles } = params;

  const notePaths = new Set(noteFiles.map((noteFile) => noteFile.path));
  const candidates: TFile[] = [];
  Vault.recurseChildren(folder, (child) => {
    if (isFile(child) && !notePaths.has(child.path)) {
      candidates.push(child);
    }
  });

  const referencingNoteByPath = new Map<string, TFile>();
  for (const noteFile of noteFiles) {
    /* v8 ignore next -- defensive ?? for a note the metadata cache has not indexed yet. */
    for (const linkPath of Object.keys(app.metadataCache.resolvedLinks[noteFile.path] ?? {})) {
      if (!referencingNoteByPath.has(linkPath)) {
        referencingNoteByPath.set(linkPath, noteFile);
      }
    }
  }

  const attachments: AttachmentToRelocate[] = [];
  for (const candidate of candidates) {
    const referencingNoteFile = referencingNoteByPath.get(candidate.path);
    if (referencingNoteFile) {
      attachments.push({ file: candidate, ownerNoteFile: referencingNoteFile });
      continue;
    }

    const owningNoteFile = await findNoteOwningAttachmentPath(app, candidate, noteFiles);
    if (owningNoteFile) {
      attachments.push({ file: candidate, ownerNoteFile: owningNoteFile });
    }
  }

  return attachments.sort((a, b) => a.file.path.localeCompare(b.file.path));
}

/**
 * Whether a markdown file is really an attachment rather than a note — an Excalidraw drawing
 * (`sketch.excalidraw.md`) is stored as markdown, so merging it would inline its raw payload into the
 * merged note (issue #160). Obsidian reports such a file's extension as `md` and its base name as
 * `sketch.excalidraw`, so the sub-extension is matched against the base name.
 *
 * TODO: this is the same "markdown file that is really an attachment" question that Consistent
 * Attachments and Links answers with its own `isTreatedAsAttachment` setting. It belongs in
 * `obsidian-dev-utils` so every plugin agrees — tracked separately; keep this local until the shared
 * predicate exists.
 *
 * @param params - The file and the configured sub-extensions.
 * @returns Whether the file is a markdown-shaped attachment.
 */
export function isMarkdownAttachment(params: IsMarkdownAttachmentParams): boolean {
  const { file, markdownAttachmentSubExtensions } = params;
  if (!isMarkdownFile(file)) {
    return false;
  }

  const lowerCaseBaseName = file.basename.toLowerCase();
  return markdownAttachmentSubExtensions.some((subExtension) => {
    const normalizedSubExtension = subExtension.trim().replace(/^\.+/, '').toLowerCase();
    return normalizedSubExtension !== '' && lowerCaseBaseName.endsWith(`.${normalizedSubExtension}`);
  });
}

/**
 * Moves each attachment to the attachment folder of the note it now belongs to, through the given
 * transaction so a cancelled operation puts everything back. The rename is the vault's own, so links to
 * the attachment are updated for us.
 *
 * @param params - The moves and the transaction to route them through.
 */
export async function relocateAttachments(params: RelocateAttachmentsParams): Promise<void> {
  const { app, relocations, vaultTransaction } = params;
  for (const relocation of relocations) {
    // Asked BEFORE resolving a destination: the destination is de-duplicated against the vault, and an
    // Attachment already at its proper path collides with ITSELF, so resolving first would rename
    // `img.png` to `img 1.png` on every run. This is exactly what `isAtProperAttachmentPath` is for.
    const isAlreadyAtProperPath = await isAtProperAttachmentPath({
      app,
      attachmentPathOrFile: relocation.attachment,
      context: AttachmentPathContext.RenameNote,
      notePathOrFile: relocation.newNoteFile
    });
    if (isAlreadyAtProperPath) {
      continue;
    }

    const newPath = await resolveAttachmentDestination({
      app,
      attachment: relocation.attachment,
      newNoteFile: relocation.newNoteFile,
      oldNoteFile: relocation.oldNoteFile
    });
    await vaultTransaction.rename(relocation.attachment, newPath);
  }
}

/**
 * Resolves where an attachment belongs once its note has moved, via `obsidian-dev-utils`
 * {@link getAttachmentFilePath}. That helper reads Obsidian's own attachment-folder configuration and is
 * the very function Custom Attachment Location patches, so a vault running that plugin gets its answer
 * without this plugin knowing it exists (issue #161).
 *
 * @param params - The attachment and the notes it moved between.
 * @returns The path the attachment should live at.
 */
export async function resolveAttachmentDestination(params: ResolveAttachmentDestinationParams): Promise<string> {
  const {
    app,
    attachment,
    newNoteFile,
    oldNoteFile
  } = params;
  return await getAttachmentFilePath({
    app,
    context: AttachmentPathContext.RenameNote,
    notePathOrFile: newNoteFile,
    oldAttachmentPathOrFile: attachment,
    oldNotePathOrFile: oldNoteFile,
    shouldSkipDuplicateCheck: false
  });
}

/*
 * Read out of the metadata cache's resolved links rather than out of the backlink index: the resolved
 * links are the same source the folder collector above reads, one pass answers it for every candidate at
 * once, and it needs nothing the backlink index adds (link positions, subpaths).
 */
function collectPathsReferencedByOtherNotes(app: App, noteFile: TFile): Set<string> {
  const paths = new Set<string>();
  for (const [sourcePath, links] of Object.entries(app.metadataCache.resolvedLinks)) {
    if (sourcePath === noteFile.path) {
      continue;
    }
    for (const linkPath of Object.keys(links)) {
      paths.add(linkPath);
    }
  }
  return paths;
}

async function findNoteOwningAttachmentPath(app: App, attachment: TFile, noteFiles: readonly TFile[]): Promise<null | TFile> {
  const attachmentFolderPath = normalizeFolderPath(attachment.parent?.path);
  for (const noteFile of noteFiles) {
    const noteFolderPath = normalizeFolderPath(noteFile.parent?.path);
    if (!isAncestorOrSelf(noteFolderPath, attachmentFolderPath)) {
      continue;
    }
    const isProper = await isAtProperAttachmentPath({
      app,
      attachmentPathOrFile: attachment,
      context: AttachmentPathContext.RenameNote,
      notePathOrFile: noteFile
    });
    if (isProper) {
      return noteFile;
    }
  }
  return null;
}

function isAncestorOrSelf(ancestorFolderPath: string, folderPath: string): boolean {
  if (ancestorFolderPath === '') {
    return true;
  }
  return folderPath === ancestorFolderPath || folderPath.startsWith(`${ancestorFolderPath}/`);
}

function isAttachmentFile(file: TFile, markdownAttachmentSubExtensions: readonly string[]): boolean {
  return !isMarkdownFile(file) || isMarkdownAttachment({ file, markdownAttachmentSubExtensions });
}

function normalizeFolderPath(folderPath: string | undefined): string {
  // The vault root reports its path as `/`; treat it as the empty prefix so it contains everything.
  return folderPath === undefined || folderPath === '/' ? '' : folderPath;
}
