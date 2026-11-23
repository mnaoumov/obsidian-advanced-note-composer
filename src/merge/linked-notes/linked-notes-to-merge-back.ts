import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type {
  App,
  CachedMetadata,
  TFile
} from 'obsidian';

import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import { parseLinktext } from 'obsidian';

import type { ResidualSourceLink } from '../residual-source-link.ts';

import { createMoveToken } from '../../smart-cut/move/move-token.ts';
import {
  findHeadingAboveResidualLink,
  findResidualSourceLink
} from '../residual-source-link.ts';

/**
 * The note a batch merge at the links goes into, and the notes linked from it.
 */
export interface LinkedNotesParams {
  readonly app: App;
  readonly targetFile: TFile;
}

/**
 * One note `Merge linked notes back into this note...` merges, with the link it goes in place of (issue #315).
 */
export interface LinkedNoteToMergeBack {
  readonly file: TFile;
  readonly link: ResidualSourceLink;
}

interface FindLinkedNotesToMergeBackParams extends LinkedNotesParams {
  /**
   * Whether a linked note is left alone because the plugin's path settings exclude it from a merge.
   */
  readonly isIgnored: (this: void, file: TFile) => boolean;
}

type HasLinkedNoteCandidateParams = LinkedNotesParams;

interface ReplaceSourceLinksWithTokensParams extends LinkedNotesParams {
  /**
   * Whether a heading right above a link that the linked note opens with as well goes with the link, so it is
   * written once (issue #314).
   */
  readonly shouldMergeHeadings: boolean;
  readonly sourceFiles: readonly TFile[];
  readonly vaultTransaction: VaultTransaction;
}

interface TokenReplacement {
  readonly endOffset: number;
  readonly startOffset: number;
  readonly token: string;
}

/**
 * Finds every note `targetFile` links or embeds on a line of its own (issue #315), in the order of those lines.
 *
 * A note qualifies exactly as for the single merge at the link ({@link findResidualSourceLink}): the target's body
 * references it once, with no heading or block subpath, and nothing else is on that line. A note linked more than
 * once, from inside a sentence, or through a subpath is left alone, as is a note the path settings exclude.
 *
 * @param params - The parameters.
 * @returns The notes to merge back, sorted by the line of their link.
 */
export async function findLinkedNotesToMergeBack(params: FindLinkedNotesToMergeBackParams): Promise<LinkedNoteToMergeBack[]> {
  const { app, isIgnored, targetFile } = params;
  const cache = await getCacheSafe(app, targetFile);
  const targetContent = await app.vault.read(targetFile);
  const linkedNotes: LinkedNoteToMergeBack[] = [];
  for (const file of collectLinkedMarkdownFiles(app, targetFile, cache)) {
    if (isIgnored(file)) {
      continue;
    }
    const link = await findResidualSourceLink({ app, sourceFile: file, targetContent, targetFile });
    if (link) {
      linkedNotes.push({ file, link });
    }
  }
  return linkedNotes.sort((a, b) => a.link.startOffset - b.link.startOffset);
}

/**
 * Whether `targetFile` links or embeds any other markdown note without a subpath, the cheap synchronous check that
 * decides whether `Merge linked notes back into this note...` is offered. The full rule runs when the command does.
 *
 * @param params - The parameters.
 * @returns `true` when some linked note might be merged back.
 */
export function hasLinkedNoteCandidate(params: HasLinkedNoteCandidateParams): boolean {
  const { app, targetFile } = params;
  return collectLinkedMarkdownFiles(app, targetFile, app.metadataCache.getFileCache(targetFile)).length > 0;
}

/**
 * Swaps the link to each of `sourceFiles` in `targetFile` for a unique insert token, in one write through the
 * transaction (issue #315).
 *
 * Done for every note before any of them is merged, so an earlier merge cannot make a later link ambiguous: the
 * content merged in may link a later note itself, and that note would then be referenced twice. Each merge then
 * goes into its own token.
 *
 * @param params - The parameters.
 * @returns The token each note goes in place of.
 */
export async function replaceSourceLinksWithTokens(params: ReplaceSourceLinksWithTokensParams): Promise<Map<TFile, string>> {
  const { app, shouldMergeHeadings, sourceFiles, targetFile, vaultTransaction } = params;
  const targetContent = await app.vault.read(targetFile);
  const tokens = new Map<TFile, string>();
  const replacements: TokenReplacement[] = [];
  for (const sourceFile of sourceFiles) {
    const residualLink = await findResidualSourceLink({ app, sourceFile, targetContent, targetFile });
    if (!residualLink) {
      throw new Error(`${targetFile.path} no longer links ${sourceFile.path} on a line of its own.`);
    }
    const headingStartOffset = shouldMergeHeadings
      ? await findHeadingAboveResidualLink({ app, residualLink, sourceFile, targetContent, targetFile })
      : null;
    const token = createMoveToken();
    tokens.set(sourceFile, token);
    replacements.push({ endOffset: residualLink.endOffset, startOffset: headingStartOffset ?? residualLink.startOffset, token });
  }

  // Bottom-up, so each replacement leaves the offsets above it as they were read.
  replacements.sort((a, b) => b.startOffset - a.startOffset);
  let content = targetContent;
  for (const replacement of replacements) {
    content = `${content.slice(0, replacement.startOffset)}${replacement.token}${content.slice(replacement.endOffset)}`;
  }
  await vaultTransaction.modify(targetFile, content);
  return tokens;
}

function collectLinkedMarkdownFiles(app: App, targetFile: TFile, cache: CachedMetadata | null): TFile[] {
  const files = new Set<TFile>();
  for (const reference of [...cache?.links ?? [], ...cache?.embeds ?? []]) {
    const { path, subpath } = parseLinktext(reference.link);
    if (subpath !== '') {
      continue;
    }
    const file = app.metadataCache.getFirstLinkpathDest(path, targetFile.path);
    if (file && file !== targetFile && isMarkdownFile(file)) {
      files.add(file);
    }
  }
  return [...files];
}
