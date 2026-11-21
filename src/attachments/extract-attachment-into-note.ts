/**
 * @file
 *
 * The pure half of `Extract attachment into its own note`: which reference under the cursor names an
 * attachment, what the new note is called, whether the attachment may be extracted at all, and how the
 * parent's block id and the links to it are rewritten.
 *
 * Two ways of owning an attachment are allowed side by side in the owner's vault. In the BLOCK model the
 * file sits in its parent note's attachment folder, embedded on one line of the parent that carries a
 * block id, and other notes link `[[parent#^block]]`. In the ATTACHMENT-NOTE model the file has a note of
 * its own, and everything links that note. This command moves one attachment from the first model to the
 * second; nothing here touches the vault, so the command handler owns every write.
 */

import type {
  App,
  CachedMetadata,
  Reference,
  ReferenceCache,
  TFile
} from 'obsidian';

import {
  isBaseFile,
  isCanvasFile,
  isMarkdownFile,
  isTreatedAsAttachment
} from '@mnaoumov/obsidian-lib/file-system';
import { splitSubpath } from '@mnaoumov/obsidian-lib/link';
import { parseLink } from '@mnaoumov/obsidian-lib/parse-link';
import { parseLinktext } from 'obsidian';

// An embed's `|300` or `|300x200` sets its displayed size; it is not a name the attachment goes by.
const EMBED_SIZE_REG_EXP = /^\d+(?:x\d+)?$/;

/**
 * The name an attachment goes by.
 */
export interface AttachmentName {
  /**
   * Whether the name came from the reference's link text rather than the file name.
   */
  readonly isFromLinkText: boolean;

  /**
   * The name.
   */
  readonly name: string;
}

/**
 * The attachment reference a cursor points at.
 */
export interface AttachmentReferenceAtCursor {
  /**
   * The attachment the reference resolves to.
   */
  readonly attachment: TFile;

  /**
   * The reference itself, an embed or a plain link.
   */
  readonly reference: ReferenceCache;
}

/**
 * Parameters for {@link findAttachmentReferenceAtCursor}.
 */
export interface FindAttachmentReferenceAtCursorParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The configured extensions that make a markdown-shaped file an attachment, e.g. `['.excalidraw.md']`.
   */
  readonly attachmentExtensions: readonly string[];

  /**
   * The note's metadata.
   */
  readonly cache: CachedMetadata;

  /**
   * The cursor's column.
   */
  readonly ch: number;

  /**
   * The cursor's line.
   */
  readonly line: number;

  /**
   * The note holding the reference.
   */
  readonly noteFile: TFile;
}

/**
 * Parameters for {@link isAttachment}.
 */
export interface IsAttachmentParams {
  /**
   * The configured extensions that make a markdown-shaped file an attachment.
   */
  readonly attachmentExtensions: readonly string[];

  /**
   * The file to judge.
   */
  readonly file: TFile;
}

/**
 * Parameters for {@link removeBlockId}.
 */
export interface RemoveBlockIdParams {
  /**
   * The block id, without its `^`.
   */
  readonly blockId: string;

  /**
   * The note's content.
   */
  readonly content: string;

  /**
   * The line the block id ends.
   */
  readonly line: number;
}

/**
 * Parameters for {@link replaceReference}.
 */
export interface ReplaceReferenceParams {
  /**
   * The note's content.
   */
  readonly content: string;

  /**
   * The new link text.
   */
  readonly newLink: string;

  /**
   * The reference to replace.
   */
  readonly reference: ReferenceCache;
}

/**
 * Builds the content of a new attachment note: its `aliases` property, when the attachment went by a name
 * other than the note's, followed by the embed.
 *
 * @param aliases - The aliases to record.
 * @param embed - The embed of the attachment.
 * @returns The note's content.
 */
export function buildAttachmentNoteContent(aliases: readonly string[], embed: string): string {
  if (aliases.length === 0) {
    return `${embed}\n`;
  }

  const aliasLines = aliases.map((alias) => `  - ${JSON.stringify(alias)}`).join('\n');
  return `---\naliases:\n${aliasLines}\n---\n\n${embed}\n`;
}

/**
 * Counts every reference to a file across the vault: links, embeds and frontmatter links, from every note.
 *
 * @param app - The Obsidian application instance.
 * @param file - The file.
 * @returns The number of references.
 */
export function countReferences(app: App, file: TFile): number {
  let count = 0;
  for (const links of Object.values(app.metadataCache.resolvedLinks)) {
    count += links[file.path] ?? 0;
  }
  return count;
}

/**
 * Finds the attachment reference the cursor points at: the embed or link the cursor sits in, or, when the
 * cursor sits elsewhere on a line holding exactly one attachment reference, that one.
 *
 * @param params - The note, its metadata and the cursor.
 * @returns The reference and the attachment it resolves to, or `null` when there is none.
 */
export function findAttachmentReferenceAtCursor(params: FindAttachmentReferenceAtCursorParams): AttachmentReferenceAtCursor | null {
  const {
    app,
    attachmentExtensions,
    cache,
    ch,
    line,
    noteFile
  } = params;

  const candidates: AttachmentReferenceAtCursor[] = [];
  for (const reference of [...cache.embeds ?? [], ...cache.links ?? []]) {
    if (reference.position.start.line > line || reference.position.end.line < line) {
      continue;
    }
    const attachment = app.metadataCache.getFirstLinkpathDest(parseLinktext(reference.link).path, noteFile.path);
    if (!attachment || !isAttachment({ attachmentExtensions, file: attachment })) {
      continue;
    }
    candidates.push({ attachment, reference });
  }

  const underCursor = candidates.find(({ reference }) =>
    (reference.position.start.line < line || reference.position.start.col <= ch)
    && (reference.position.end.line > line || ch <= reference.position.end.col)
  );
  if (underCursor) {
    return underCursor;
  }

  const [onlyCandidate, ...otherCandidates] = candidates;
  return onlyCandidate && otherCandidates.length === 0 ? onlyCandidate : null;
}

/**
 * Finds the block id of the block holding a line, if that block has one.
 *
 * @param cache - The note's metadata.
 * @param line - The line.
 * @returns The block id, without its `^`, or `null`.
 */
export function findBlockIdOnLine(cache: CachedMetadata, line: number): null | string {
  for (const block of Object.values(cache.blocks ?? {})) {
    if (block.position.start.line <= line && line <= block.position.end.line) {
      return block.id;
    }
  }
  return null;
}

/**
 * Tells an attachment from a note. Markdown, canvas and base files are notes; a markdown-shaped file whose
 * whole name matches a configured attachment extension (an `Excalidraw` drawing) is an attachment.
 *
 * @param params - The file and the configured extensions.
 * @returns Whether the file is an attachment.
 */
export function isAttachment(params: IsAttachmentParams): boolean {
  const { attachmentExtensions, file } = params;
  return isMarkdownFile(file) ? isTreatedAsAttachment({ attachmentExtensions, pathOrFile: file }) : !isCanvasFile(file) && !isBaseFile(file);
}

/**
 * Tells whether a link points at one block of a note.
 *
 * @param reference - The link.
 * @param blockId - The block id, without its `^`.
 * @returns Whether the link's subpath is exactly that block.
 */
export function isLinkToBlock(reference: Reference, blockId: string): boolean {
  return splitSubpath(reference.link).subpath === `#^${blockId}`;
}

/**
 * Removes a block id from the end of the line it ends.
 *
 * @param params - The content, the line and the block id.
 * @returns The content without the block id, or the content unchanged when the line does not end with it.
 */
export function removeBlockId(params: RemoveBlockIdParams): string {
  const { blockId, content, line } = params;
  const lines = content.split('\n');
  const lineText = lines[line];
  if (lineText === undefined) {
    return content;
  }

  const suffix = `^${blockId}`;
  const trimmed = lineText.trimEnd();
  if (!trimmed.endsWith(suffix)) {
    return content;
  }

  lines[line] = trimmed.slice(0, -suffix.length).trimEnd();
  return lines.join('\n');
}

/**
 * Replaces one reference in a note's content with new link text.
 *
 * @param params - The content, the reference and the new link.
 * @returns The new content.
 * @throws When the content no longer holds the reference at its cached position, so a stale cache can never
 * overwrite the wrong text.
 */
export function replaceReference(params: ReplaceReferenceParams): string {
  const { content, newLink, reference } = params;
  const { end, start } = reference.position;
  if (content.slice(start.offset, end.offset) !== reference.original) {
    throw new Error(`The note changed: ${reference.original} is no longer where it was.`);
  }
  return content.slice(0, start.offset) + newLink + content.slice(end.offset);
}

/**
 * Resolves the name the attachment goes by: the link text of its reference when there is one, else the
 * file's base name. An embed size (`|300`) is not a name.
 *
 * @param reference - The attachment's reference.
 * @param attachment - The attachment.
 * @returns The name, and whether it came from the link text (and so belongs in the note's aliases).
 */
export function resolveAttachmentName(reference: Reference, attachment: TFile): AttachmentName {
  const alias = parseLink(reference.original)?.alias?.trim() ?? '';
  return alias === '' || EMBED_SIZE_REG_EXP.test(alias) || alias === attachment.name || alias === attachment.basename ? { isFromLinkText: false, name: attachment.basename } : { isFromLinkText: true, name: alias };
}
