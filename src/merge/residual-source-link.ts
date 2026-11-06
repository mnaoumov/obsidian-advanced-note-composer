import type {
  App,
  ReferenceCache,
  TFile
} from 'obsidian';

import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import { parseLinktext } from 'obsidian';

/**
 * The one link or embed in a target note that a merge of the source note can replace (issue #310's merge-back).
 */
export interface ResidualSourceLink {
  /**
   * The offset just past the reference in the target note.
   */
  readonly endOffset: number;

  /**
   * The zero-based line the reference sits on.
   */
  readonly line: number;

  /**
   * The reference text as written, e.g. `[[Note]]` or `![[Note]]`.
   */
  readonly original: string;

  /**
   * The offset the reference starts at in the target note.
   */
  readonly startOffset: number;
}

interface FindResidualSourceLinkParams {
  readonly app: App;
  readonly sourceFile: TFile;
  readonly targetContent: string;
  readonly targetFile: TFile;
}

/**
 * Finds the reference a merge of `sourceFile` into `targetFile` can be inserted in place of: the residual an
 * extract leaves behind.
 *
 * It qualifies only when the target's BODY references the source exactly once, with no subpath, and that
 * reference is alone on its line. Several references, a heading or block link, or a link inside a sentence are
 * all ambiguous about where a whole note belongs, so they answer `null` and the merge appends or prepends as
 * before. The cache's offsets are checked against `targetContent`, so a stale cache answers `null` as well.
 *
 * @param params - The parameters.
 * @returns The reference, or `null` when there is none to replace.
 */
export async function findResidualSourceLink(params: FindResidualSourceLinkParams): Promise<null | ResidualSourceLink> {
  const { app, sourceFile, targetContent, targetFile } = params;
  if (sourceFile === targetFile) {
    return null;
  }
  const cache = await getCacheSafe(app, targetFile);
  const references: ReferenceCache[] = [...cache?.links ?? [], ...cache?.embeds ?? []];
  const sourceReferences = references.filter((reference) => {
    const { path } = parseLinktext(reference.link);
    return app.metadataCache.getFirstLinkpathDest(path, targetFile.path) === sourceFile;
  });

  if (sourceReferences.length !== 1) {
    return null;
  }

  const [reference] = sourceReferences;
  if (!reference || parseLinktext(reference.link).subpath !== '') {
    return null;
  }

  const startOffset = reference.position.start.offset;
  const endOffset = reference.position.end.offset;
  if (targetContent.slice(startOffset, endOffset) !== reference.original) {
    return null;
  }

  const lineStart = targetContent.lastIndexOf('\n', startOffset - 1) + 1;
  const lineEndIndex = targetContent.indexOf('\n', endOffset);
  const lineEnd = lineEndIndex === -1 ? targetContent.length : lineEndIndex;
  const isAloneOnLine = targetContent.slice(lineStart, startOffset).trim() === '' && targetContent.slice(endOffset, lineEnd).trim() === '';
  if (!isAloneOnLine) {
    return null;
  }

  return {
    endOffset,
    line: reference.position.start.line,
    original: reference.original,
    startOffset
  };
}
