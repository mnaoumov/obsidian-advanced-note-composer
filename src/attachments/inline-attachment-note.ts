/**
 * @file
 *
 * The pure half of `Inline attachment note into its parent`, the reverse of `Extract attachment into its own
 * note`: whether a note is an attachment note, what its attachment will be called on the parent's line, what
 * inlining it would drop, which note can be its parent, and how the parent's line gets a block id.
 *
 * An ATTACHMENT NOTE is a note whose body holds exactly one reference, to an attachment, plus whatever
 * properties it carries. Inlining it moves the attachment into the parent's attachment folder, puts the
 * attachment on the parent's line in place of the link to the note, and points every other link to the note
 * at that line's block. Nothing here touches the vault, so the command handler owns every write.
 */

import type {
  App,
  CachedMetadata,
  Pos,
  Reference,
  ReferenceCache,
  TFile
} from 'obsidian';

import { parseLink } from '@mnaoumov/obsidian-lib/parse-link';
import {
  getFrontMatterInfo,
  parseFrontMatterAliases,
  parseLinktext
} from 'obsidian';

import { isAttachment } from './extract-attachment-into-note.ts';

// Obsidian's own block ids are six characters of lowercase letters and digits.
const BLOCK_ID_LENGTH = 6;
const BLOCK_ID_RADIX = 36;
// `Number.prototype.toString` writes `0.` before the random digits.
const RANDOM_DIGITS_START = 2;
const ALIAS_PROPERTY_KEYS = new Set(['alias', 'aliases']);

/**
 * Parameters for {@link analyzeAttachmentNote}.
 */
export interface AnalyzeAttachmentNoteParams extends FindAttachmentNoteReferenceParams {
  /**
   * The note's content.
   */
  readonly content: string;
}

/**
 * Parameters for {@link appendBlockId}.
 */
export interface AppendBlockIdParams {
  /**
   * The block id, without its `^`.
   */
  readonly blockId: string;

  /**
   * The note's content.
   */
  readonly content: string;

  /**
   * The line that ends the block.
   */
  readonly line: number;
}

/**
 * What inlining an attachment note would do, and what it would drop.
 */
export interface AttachmentNoteAnalysis {
  /**
   * The attachment the note holds.
   */
  readonly attachment: TFile;

  /**
   * The aliases after the first, which no line of the parent can carry.
   */
  readonly droppedAliases: readonly string[];

  /**
   * The names of the properties other than `aliases`.
   */
  readonly droppedProperties: readonly string[];

  /**
   * The note's body text other than the reference, trimmed; empty when there is none.
   */
  readonly droppedText: string;

  /**
   * Whether the note embeds the attachment rather than linking it.
   */
  readonly isEmbed: boolean;

  /**
   * The link text the attachment carries on the parent's line, or `null` for none.
   */
  readonly linkText: null | string;
}

/**
 * The attachment an attachment note holds, and the note's reference to it.
 */
export interface AttachmentNoteReference {
  /**
   * The attachment.
   */
  readonly attachment: TFile;

  /**
   * The note's reference to the attachment.
   */
  readonly reference: ReferenceCache;
}

/**
 * Parameters for {@link findAttachmentNoteReference}.
 */
export interface FindAttachmentNoteReferenceParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The configured extensions that make a markdown-shaped file an attachment.
   */
  readonly attachmentExtensions: readonly string[];

  /**
   * The note's metadata.
   */
  readonly cache: CachedMetadata;

  /**
   * The note.
   */
  readonly noteFile: TFile;
}

/**
 * Parameters for {@link findReferencesToNote}.
 */
export interface FindReferencesToNoteParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The metadata of the note holding the references.
   */
  readonly cache: CachedMetadata;

  /**
   * The note the references point at.
   */
  readonly noteFile: TFile;

  /**
   * The note holding the references.
   */
  readonly sourceFile: TFile;
}

/**
 * Parameters for {@link isLinkToRewrite}.
 */
export interface IsLinkToRewriteParams {
  /**
   * The parent's reference the attachment takes the place of.
   */
  readonly mainReference: ReferenceCache;

  /**
   * The attachment note's path.
   */
  readonly notePath: string;

  /**
   * The parent's path.
   */
  readonly parentPath: string;

  /**
   * The link.
   */
  readonly reference: Reference;

  /**
   * The path of the note holding the link.
   */
  readonly sourcePath: string;
}

/**
 * A note that can become an attachment note's parent.
 */
export interface ParentCandidate {
  /**
   * The note.
   */
  readonly file: TFile;

  /**
   * Whether it links the attachment note from a list item.
   */
  readonly isFromList: boolean;
}

interface ResolveLinkTextParams {
  readonly attachmentNames: readonly string[];
  readonly firstAlias: string | undefined;
  readonly noteName: string;
  readonly ownAlias: null | string;
}

/**
 * Analyses an attachment note: the attachment it holds, the link text that attachment takes on the parent's
 * line, and what inlining it would drop.
 *
 * The link text is the first alias, else the note's name when it differs from the file's, else the note's
 * own link text for the attachment (an embed size such as `|300`).
 *
 * @param params - The note, its content and metadata.
 * @returns The analysis, or `null` when the note is not an attachment note.
 */
export function analyzeAttachmentNote(params: AnalyzeAttachmentNoteParams): AttachmentNoteAnalysis | null {
  const { cache, content, noteFile } = params;
  const found = findAttachmentNoteReference(params);
  if (!found) {
    return null;
  }

  const { attachment, reference } = found;
  const aliases = (parseFrontMatterAliases(cache.frontmatter) ?? []).map((alias) => alias.trim()).filter((alias) => alias !== '');
  const [firstAlias] = aliases;
  const parsed = parseLink(reference.original);
  const attachmentNames = [attachment.basename, attachment.name];
  const linkText = resolveLinkText({ attachmentNames, firstAlias, noteName: noteFile.basename, ownAlias: parsed?.alias ?? null });

  const bodyStart = getFrontMatterInfo(content).contentStart;
  const { end, start } = reference.position;
  const droppedText = (content.slice(bodyStart, start.offset) + content.slice(end.offset)).trim();

  return {
    attachment,
    droppedAliases: aliases.filter((alias) => alias !== linkText && !attachmentNames.includes(alias)),
    droppedProperties: Object.keys(cache.frontmatter ?? {}).filter((key) => !ALIAS_PROPERTY_KEYS.has(key)),
    droppedText,
    isEmbed: parsed?.isEmbed ?? false,
    linkText
  };
}

/**
 * Appends a block id to the line that ends a block.
 *
 * @param params - The content, the line and the block id.
 * @returns The new content.
 */
export function appendBlockId(params: AppendBlockIdParams): string {
  const { blockId, content, line } = params;
  const lines = content.split('\n');
  const lineText = lines[line];
  if (lineText === undefined) {
    throw new Error(`The note has no line ${String(line)} to give the block id ^${blockId}.`);
  }

  lines[line] = `${lineText.trimEnd()} ^${blockId}`;
  return lines.join('\n');
}

/**
 * Finds the reference an attachment note holds: its body must hold exactly one reference, and it must resolve
 * to an attachment.
 *
 * @param params - The note and its metadata.
 * @returns The attachment and the reference, or `null` when the note is not an attachment note.
 */
export function findAttachmentNoteReference(params: FindAttachmentNoteReferenceParams): AttachmentNoteReference | null {
  const {
    app,
    attachmentExtensions,
    cache,
    noteFile
  } = params;
  const [reference, ...otherReferences] = [...cache.embeds ?? [], ...cache.links ?? []];
  if (!reference || otherReferences.length > 0) {
    return null;
  }
  const attachment = app.metadataCache.getFirstLinkpathDest(parseLinktext(reference.link).path, noteFile.path);
  return attachment && isAttachment({ attachmentExtensions, file: attachment }) ? { attachment, reference } : null;
}

/**
 * Finds the line that ends the block holding a line: the list item holding it, else the section holding it,
 * else the line itself. A block id only names a block from that line.
 *
 * @param cache - The note's metadata.
 * @param line - The line.
 * @returns The line that ends the block.
 */
export function findBlockEndLine(cache: CachedMetadata, line: number): number {
  // The innermost list item holding the line is the last one, since a child item follows its parent.
  let listItemEndLine: null | number = null;
  for (const listItem of cache.listItems ?? []) {
    if (doesPositionHoldLine(listItem.position, line)) {
      listItemEndLine = listItem.position.end.line;
    }
  }
  const section = (cache.sections ?? []).find((candidate) => doesPositionHoldLine(candidate.position, line));
  return listItemEndLine ?? section?.position.end.line ?? line;
}

/**
 * Lists the notes that can become an attachment note's parent: every other note whose body links it. The
 * notes that link it from a list item, an attachment list, come first.
 *
 * @param app - The Obsidian application instance.
 * @param noteFile - The attachment note.
 * @returns The candidate parents, those linking from a list first, then by path.
 */
export function findParentCandidates(app: App, noteFile: TFile): ParentCandidate[] {
  const candidates: ParentCandidate[] = [];
  for (const [sourcePath, links] of Object.entries(app.metadataCache.resolvedLinks)) {
    if (sourcePath === noteFile.path || (links[noteFile.path] ?? 0) === 0) {
      continue;
    }
    const sourceFile = app.vault.getFileByPath(sourcePath);
    const cache = sourceFile ? app.metadataCache.getFileCache(sourceFile) : null;
    const references = sourceFile && cache ? findReferencesToNote({ app, cache, noteFile, sourceFile }) : [];
    if (!sourceFile || !cache || references.length === 0) {
      continue;
    }
    const isFromList = references.some((reference) => (cache.listItems ?? []).some((listItem) => doesPositionHoldLine(listItem.position, reference.position.start.line)));
    candidates.push({ file: sourceFile, isFromList });
  }
  return candidates.sort((a, b) => Number(b.isFromList) - Number(a.isFromList) || a.file.path.localeCompare(b.file.path));
}

/**
 * Lists the body references a note holds to another note, in document order.
 *
 * @param params - The two notes and the holder's metadata.
 * @returns The references.
 */
export function findReferencesToNote(params: FindReferencesToNoteParams): ReferenceCache[] {
  const {
    app,
    cache,
    noteFile,
    sourceFile
  } = params;
  return [...cache.embeds ?? [], ...cache.links ?? []]
    .filter((reference) => app.metadataCache.getFirstLinkpathDest(parseLinktext(reference.link).path, sourceFile.path) === noteFile)
    .sort((a, b) => a.position.start.offset - b.position.start.offset);
}

/**
 * Generates a block id no block of the note already has.
 *
 * @param existingIds - The note's block ids.
 * @param random - The random source.
 * @returns The block id, without its `^`.
 */
export function generateBlockId(existingIds: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    const id = random().toString(BLOCK_ID_RADIX).slice(RANDOM_DIGITS_START, RANDOM_DIGITS_START + BLOCK_ID_LENGTH);
    if (id.length === BLOCK_ID_LENGTH && !existingIds.has(id)) {
      return id;
    }
  }
}

/**
 * Tells whether a link to the attachment note is one to point at the parent's block: every link except the
 * parent's reference the attachment takes the place of, and the note's own links to itself.
 *
 * @param params - The link and the notes involved.
 * @returns Whether to rewrite the link.
 */
export function isLinkToRewrite(params: IsLinkToRewriteParams): boolean {
  const {
    mainReference,
    notePath,
    parentPath,
    reference,
    sourcePath
  } = params;
  const isMainReference = sourcePath === parentPath && isReferenceCache(reference) && reference.position.start.offset === mainReference.position.start.offset;
  return sourcePath !== notePath && !isMainReference;
}

/**
 * Picks the parent's reference the attachment takes the place of: its first embed of the note, else its first
 * link to it.
 *
 * @param references - The parent's references to the note, in document order.
 * @returns The reference, or `null` when there is none.
 */
export function pickMainReference(references: readonly ReferenceCache[]): null | ReferenceCache {
  return references.find((reference) => parseLink(reference.original)?.isEmbed === true) ?? references[0] ?? null;
}
/**
 * Tells whether a position spans a line.
 *
 * @param position - The position.
 * @param line - The line.
 * @returns Whether the line lies within it.
 */
function doesPositionHoldLine(position: Pos, line: number): boolean {
  return position.start.line <= line && line <= position.end.line;
}

/**
 * Tells a body or frontmatter reference with a position from one without.
 *
 * @param reference - The reference.
 * @returns Whether it has a position.
 */
function isReferenceCache(reference: Reference): reference is ReferenceCache {
  return 'position' in reference;
}

/**
 * Resolves the link text the attachment carries on the parent's line: the note's first alias, else the note's
 * name when it differs from the file's, else the note's own link text for the attachment.
 *
 * @param params - The names involved.
 * @returns The link text, or `null` for none.
 */
function resolveLinkText(params: ResolveLinkTextParams): null | string {
  const {
    attachmentNames,
    firstAlias,
    noteName,
    ownAlias
  } = params;
  if (firstAlias !== undefined && !attachmentNames.includes(firstAlias)) {
    return firstAlias;
  }
  return attachmentNames.includes(noteName) ? ownAlias : noteName;
}
