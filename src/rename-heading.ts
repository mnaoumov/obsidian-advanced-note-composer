import type {
  App,
  Reference
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { PathOrFile } from 'obsidian-dev-utils/obsidian/file-system';
import type { GenerateRawMarkdownLinkParams } from 'obsidian-dev-utils/obsidian/link';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { normalizeOptionalProperties } from 'obsidian-dev-utils/object-utils';
import {
  editLinks,
  generateRawMarkdownLink,
  splitSubpath
} from 'obsidian-dev-utils/obsidian/link';
import { getBacklinksForFileSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { parseLink } from 'obsidian-dev-utils/obsidian/parse-link';

// Mirrors Obsidian's internal heading normalization used to MATCH a heading against a link subpath
// Segment (the core `rename this heading` command lowercases and replaces these characters with a
// Space, then collapses whitespace). Two heading texts are "the same heading" when their normalized
// Forms are equal, so a link's stored subpath segment can be matched to the heading being renamed.
const HEADING_MATCH_STRIP_REGEXP = /[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g;

// Mirrors Obsidian's sanitization of a heading written INTO a link subpath: characters that would
// Break the subpath (`:`, `#`, `|`, `^`, `\`, newlines, `%%`, `[[`, `]`) are replaced with a space
// And whitespace collapsed. This is applied to the NEW heading text before it is spliced into a link.
const SUBPATH_SANITIZE_REGEXP = /(?:[:#|^\\\r\n]|%%|\[\[|]])/g;

const WHITESPACE_RUN_REGEXP = /\s+/g;

/**
 * Parameters for {@link rewriteHeadingLink}.
 */
export interface RewriteHeadingLinkParams {
  /**
   * The link reference to rewrite.
   */
  readonly link: Reference;

  /**
   * The new heading text (as it now appears in the note).
   */
  readonly newHeading: string;

  /**
   * The old heading text (as it appeared before the rename).
   */
  readonly oldHeading: string;
}

/**
 * Parameters for {@link rewriteHeadingSubpath}.
 */
export interface RewriteHeadingSubpathParams {
  /**
   * The new heading text (as it now appears in the note).
   */
  readonly newHeading: string;

  /**
   * The old heading text (as it appeared before the rename).
   */
  readonly oldHeading: string;

  /**
   * The link subpath, including its leading `#` (e.g. `#Parent#Child`).
   */
  readonly subpath: string;
}

/**
 * Parameters for {@link updateHeadingBacklinks}.
 */
export interface UpdateHeadingBacklinksParams {
  /**
   * The abort signal that cancels the vault-wide rewrite (shared with the operation's lock).
   */
  readonly abortSignal: AbortSignal;

  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The new heading text (as it now appears in the note).
   */
  readonly newHeading: string;

  /**
   * The note whose heading was renamed; its backlinks are the links to rewrite.
   */
  readonly notePathOrFile: PathOrFile;

  /**
   * The old heading text (as it appeared before the rename).
   */
  readonly oldHeading: string;

  /**
   * The plugin notice component (threaded into the dev-utils link editor).
   */
  readonly pluginNoticeComponent: PluginNoticeComponent;

  /**
   * The per-plugin resource-lock component (threaded into the dev-utils link editor).
   */
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Rewrites a single link reference when its subpath contains the renamed heading as a segment (at any
 * position — start, middle, or end of a nested `#A#B#C` subpath). The link's target path, style
 * (wikilink / markdown / embed / angle-bracket), alias, and title are preserved; only the matching
 * subpath segment(s) are replaced. Block references (`#^id`) and links whose subpath does not contain
 * the heading are left untouched (returns `undefined`).
 *
 * @param params - The link and the old/new heading text.
 * @returns The rewritten raw link text, or `undefined` when the link needs no change.
 */
export function rewriteHeadingLink(params: RewriteHeadingLinkParams): string | undefined {
  const { link, newHeading, oldHeading } = params;
  const parsed = parseLink(link.original);
  if (!parsed || parsed.isExternal) {
    return undefined;
  }

  const { linkPath, subpath } = splitSubpath(link.link);
  const newSubpath = rewriteHeadingSubpath({ newHeading, oldHeading, subpath });
  if (newSubpath === null) {
    return undefined;
  }

  return generateRawMarkdownLink(normalizeOptionalProperties<GenerateRawMarkdownLinkParams>({
    alias: parsed.alias,
    isEmbed: parsed.isEmbed,
    isWikilink: parsed.isWikilink,
    shouldUseAngleBrackets: parsed.hasAngleBrackets,
    title: parsed.title,
    url: linkPath + newSubpath
  }));
}

/**
 * Rewrites a link subpath so that every segment matching the old heading (comparing with Obsidian's
 * heading normalization) becomes the new heading. Handles the heading at the start, middle, or end of a
 * multi-segment subpath, and leaves block-reference segments (`#^id`) untouched.
 *
 * @param params - The subpath and the old/new heading text.
 * @returns The rewritten subpath (with its leading `#`), or `null` when nothing matched.
 */
export function rewriteHeadingSubpath(params: RewriteHeadingSubpathParams): null | string {
  const { newHeading, oldHeading, subpath } = params;
  if (!subpath.startsWith('#')) {
    return null;
  }

  const normalizedOldHeading = normalizeHeadingForComparison(oldHeading);
  if (normalizedOldHeading === '') {
    return null;
  }

  const sanitizedNewHeading = sanitizeHeadingForSubpath(newHeading);
  const newSegments: string[] = [];
  let hasChanged = false;
  for (const segment of subpath.slice(1).split('#')) {
    if (!segment.startsWith('^') && normalizeHeadingForComparison(segment) === normalizedOldHeading) {
      newSegments.push(sanitizedNewHeading);
      hasChanged = true;
    } else {
      newSegments.push(segment);
    }
  }

  if (!hasChanged) {
    return null;
  }

  return `#${newSegments.join('#')}`;
}

/**
 * Rewrites, across the whole vault, every link whose subpath references the renamed heading of a note —
 * including nested subpaths where the heading appears only as a middle segment (e.g.
 * `[[note#Second Concept#Definition]]` when `Second Concept` is renamed), which Obsidian's own
 * `rename this heading` command leaves broken. Iterates the note's backlinks and rewrites only the
 * matching references, preserving each link's target, style, alias, and title.
 *
 * @param params - The note, the old/new heading text, and the shared app/lock/abort/notice context.
 * @returns The number of links rewritten.
 */
export async function updateHeadingBacklinks(params: UpdateHeadingBacklinksParams): Promise<number> {
  const {
    abortSignal,
    app,
    newHeading,
    notePathOrFile,
    oldHeading,
    pluginNoticeComponent,
    resourceLockComponent
  } = params;

  const backlinks = await getBacklinksForFileSafe({ app, pathOrFile: notePathOrFile });
  // Collected in a `const` array (not a reassigned counter) so the per-file link converter closure can
  // Safely record rewrites without an unsafe reference to a loop-mutated variable.
  const rewrittenLinks: string[] = [];

  for (const backlinkPath of backlinks.keys()) {
    /* v8 ignore next -- `get` on a key from `keys()` is always non-null; the `?? []` is defensive. */
    const references = backlinks.get(backlinkPath) ?? [];
    const referenceJsons = new Set(references.map((reference) => JSON.stringify(reference)));
    await editLinks({
      abortSignal,
      app,
      linkConverter: (link) => {
        if (!referenceJsons.has(JSON.stringify(link))) {
          return undefined;
        }
        const rewritten = rewriteHeadingLink({ link, newHeading, oldHeading });
        if (rewritten === undefined) {
          return undefined;
        }
        rewrittenLinks.push(rewritten);
        return rewritten;
      },
      pathOrFile: backlinkPath,
      pluginNoticeComponent,
      resourceLockComponent
    });
  }

  return rewrittenLinks.length;
}

function normalizeHeadingForComparison(heading: string): string {
  return heading.replace(HEADING_MATCH_STRIP_REGEXP, ' ').replace(WHITESPACE_RUN_REGEXP, ' ').trim().toLowerCase();
}

function sanitizeHeadingForSubpath(heading: string): string {
  return heading.replace(SUBPATH_SANITIZE_REGEXP, ' ').replace(WHITESPACE_RUN_REGEXP, ' ').trim();
}
