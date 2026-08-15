import type {
  App,
  Pos,
  TFile,
  TFolder
} from 'obsidian';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import {
  parseLinktext,
  Vault
} from 'obsidian';
import {
  AttachmentPathContext,
  getAttachmentFilePath,
  isAtProperAttachmentPath
} from 'obsidian-dev-utils/obsidian/attachment-path';
import {
  isFile,
  isMarkdownFile,
  isTreatedAsAttachment
} from 'obsidian-dev-utils/obsidian/file-system';

import type { Selection } from './composers/composer-base.ts';

import { compareNatural } from './natural-sort.ts';

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
   * The configured extensions that make a file an attachment, e.g. `['.excalidraw.md']`.
   */
  readonly attachmentExtensions: readonly string[];

  /**
   * The note whose attachments are collected.
   */
  readonly noteFile: TFile;
}

/**
 * Parameters for {@link collectAttachmentsReferencedBySelections}.
 */
export interface CollectAttachmentsReferencedBySelectionsParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The configured extensions that make a file an attachment, e.g. `['.excalidraw.md']`.
   */
  readonly attachmentExtensions: readonly string[];

  /**
   * The ranges of the source note being extracted, in the source note's own offsets.
   */
  readonly selections: readonly Selection[];

  /**
   * The note being split. Its attachments are the candidates; it is also the `ownerNoteFile` of every
   * collected one, since the extracted text is what referenced them.
   */
  readonly sourceFile: TFile;
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
 * Links to ordinary notes are never collected; a markdown file that is really an attachment (one whose
 * extension is configured, per `obsidian-dev-utils` {@link isTreatedAsAttachment}) is.
 *
 * Deliberately narrower than {@link collectAttachmentsToRelocate}, which ALSO takes unreferenced files
 * sitting at a proper attachment path: that rule is only safe because a folder merge is moving the whole
 * folder anyway. A single note shares its folder with its neighbors, so the same rule would drag files
 * that have nothing to do with it. An unreferenced stray in a per-note attachment folder is therefore
 * left behind — the cost of never touching a file the merged note does not point at.
 *
 * @param params - The note, the app, and the attachment extensions.
 * @returns The attachments to relocate with their owning note, in path order.
 */
export function collectAttachmentsOwnedByNote(params: CollectAttachmentsOwnedByNoteParams): AttachmentToRelocate[] {
  const { app, attachmentExtensions, noteFile } = params;

  const candidates = new Map<string, TFile>();
  /* v8 ignore next -- defensive ?? for a note the metadata cache has not indexed yet. */
  for (const linkPath of Object.keys(app.metadataCache.resolvedLinks[noteFile.path] ?? {})) {
    const linkedFile = app.vault.getFileByPath(linkPath);
    if (linkedFile && isAttachmentFile(linkedFile, attachmentExtensions)) {
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

  return attachments.sort((a, b) => compareNatural(a.file.path, b.file.path));
}

/**
 * Collects the attachments the EXTRACTED PART of a note owns, so a split carries them into the new note's
 * attachment folder (issue #239). This is the split-side counterpart of {@link collectAttachmentsOwnedByNote},
 * and the ownership question is the reason it exists: a merge relocates a whole note, so "which attachments
 * are the note's" is enough, while a split carves out a RANGE — the same note keeps the rest, so ownership
 * has to be resolved per selection rather than per file.
 *
 * An attachment is collected when the extracted range is its SOLE referencer:
 *
 * - it is referenced from inside one of the selections (`embeds` and `links` alike, so an embedded image
 *   and a plain link to a PDF are treated the same), and
 * - nothing outside those selections references it — neither the source note's own remaining text nor any
 *   other note in the vault.
 *
 * That second rule is what makes moving safe enough to be on by default: an attachment referenced by both
 * the extracted heading and the text left behind would otherwise be moved out from under the source note,
 * which is strictly worse than leaving it where it is. Links to ordinary notes are never collected; a
 * markdown file that is really an attachment (one whose extension is configured, per `obsidian-dev-utils`
 * {@link isTreatedAsAttachment}) is.
 *
 * Unlike {@link collectAttachmentsToRelocate} it never takes an unreferenced file sitting at a proper
 * attachment path: a split moves no folder, so an untouched stray has nothing to do with the extracted text.
 *
 * @param params - The source note, its extracted ranges, the app, and the attachment extensions.
 * @returns The attachments to relocate with their owning note, in path order.
 */
export function collectAttachmentsReferencedBySelections(params: CollectAttachmentsReferencedBySelectionsParams): AttachmentToRelocate[] {
  const {
    app,
    attachmentExtensions,
    selections,
    sourceFile
  } = params;

  const cache = app.metadataCache.getFileCache(sourceFile);
  // Embeds and links in one pass: the reported case is an embedded image, but a heading that merely LINKS
  // To its PDF owns it just as much.
  /* v8 ignore next 2 -- defensive ?? for a note the metadata cache has not indexed yet. */
  const references = [...cache?.embeds ?? [], ...cache?.links ?? []];

  const selectedAttachments = new Map<string, TFile>();
  const pathsReferencedByTheRemainder = new Set<string>();

  for (const reference of references) {
    // The subpath is dropped: `![[img.png#page=2]]` points at the same file as `![[img.png]]`.
    const linkedFile = app.metadataCache.getFirstLinkpathDest(parseLinktext(reference.link).path, sourceFile.path);
    if (!linkedFile) {
      continue;
    }

    if (!isSelected(reference.position, selections)) {
      // Anything the note still points at after the extraction keeps it here, whether or not it is an
      // Attachment — the check below only ever asks about paths, so classifying it would be wasted work.
      pathsReferencedByTheRemainder.add(linkedFile.path);
      continue;
    }

    if (isAttachmentFile(linkedFile, attachmentExtensions)) {
      selectedAttachments.set(linkedFile.path, linkedFile);
    }
  }

  const pathsReferencedByOtherNotes = collectPathsReferencedByOtherNotes(app, sourceFile);
  const attachments: AttachmentToRelocate[] = [];
  for (const candidate of selectedAttachments.values()) {
    if (pathsReferencedByTheRemainder.has(candidate.path) || pathsReferencedByOtherNotes.has(candidate.path)) {
      continue;
    }
    attachments.push({ file: candidate, ownerNoteFile: sourceFile });
  }

  return attachments.sort((a, b) => compareNatural(a.file.path, b.file.path));
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

  return attachments.sort((a, b) => compareNatural(a.file.path, b.file.path));
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

function isAttachmentFile(file: TFile, attachmentExtensions: readonly string[]): boolean {
  // The markdown gate stays: a non-markdown file is an attachment whatever the configured extensions
  // Say, and only a markdown-shaped one has to prove itself against them.
  return !isMarkdownFile(file) || isTreatedAsAttachment({ attachmentExtensions, pathOrFile: file });
}

function isSelected(position: Pos, selections: readonly Selection[]): boolean {
  // Wholly inside, matching `ComposerBase`'s own rule: a reference straddling the boundary is not part of
  // What gets extracted, so the note keeps pointing at it.
  return selections.some((selection) => selection.startOffset <= position.start.offset && position.end.offset <= selection.endOffset);
}

function normalizeFolderPath(folderPath: string | undefined): string {
  // The vault root reports its path as `/`; treat it as the empty prefix so it contains everything.
  return folderPath === undefined || folderPath === '/' ? '' : folderPath;
}
