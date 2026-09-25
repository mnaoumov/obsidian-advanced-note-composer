import type {
  App,
  CachedMetadata,
  HeadingCache
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { resolveSubpath } from 'obsidian';
import {
  editBacklinks,
  splitSubpath
} from 'obsidian-dev-utils/obsidian/link';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type {
  HeadingTreeNode,
  SplitReorderableSectionsResult
} from './heading-sections.ts';

import {
  normalizeHeadingForComparison,
  replaceLinkUrl,
  sanitizeHeadingForSubpath
} from './rename-heading.ts';

/**
 * Parameters for {@link resolveReorderedHeadingSubpath}.
 */
export interface ResolveReorderedHeadingSubpathParams {
  /**
   * The heading paths of the REORDERED note, indexed by new heading position: each one the heading texts
   * from its top-level ancestor down to the heading itself.
   */
  readonly newHeadingPaths: readonly (readonly string[])[];

  /**
   * The heading paths of the note BEFORE the reorder, indexed by old heading position, shaped like
   * {@link ResolveReorderedHeadingSubpathParams.newHeadingPaths}.
   */
  readonly oldHeadingPaths: readonly (readonly string[])[];

  /**
   * Which heading of the reordered note a subpath now resolves to, or `null` for none.
   */
  readonly resolveNewHeadingIndex: (subpath: string) => null | number;

  /**
   * Which heading of the note BEFORE the reorder a subpath resolved to, or `null` for none.
   */
  readonly resolveOldHeadingIndex: (subpath: string) => null | number;

  /**
   * The link subpath, with its leading `#`.
   */
  readonly subpath: string;

  /**
   * Where each heading moved: `toNewHeadingIndex(old)` is its position in the reordered note.
   */
  readonly toNewHeadingIndex: (oldHeadingIndex: number) => null | number;
}

/**
 * Parameters for {@link updateReorderedHeadingLinks}.
 */
export interface UpdateReorderedHeadingLinksParams {
  readonly abortSignal: AbortSignal;
  readonly app: App;

  /**
   * The note's metadata AFTER the reorder was written.
   */
  readonly newCache: CachedMetadata;

  /**
   * The note's metadata BEFORE the reorder, which is what every existing link was written against.
   */
  readonly oldCache: CachedMetadata;

  /**
   * The confirmed order: a depth-first permutation of section indices.
   */
  readonly order: readonly number[];

  readonly path: string;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly resourceLockComponent: ResourceLockComponent;

  /**
   * The split note, holding the confirmed tree.
   */
  readonly split: SplitReorderableSectionsResult;
}

interface HeadingPathStackEntry {
  readonly level: number;
  readonly path: string[];
}

/**
 * Works out the subpath a heading link needs after `Reorder headings` moved headings around (issue #295).
 *
 * Two kinds of link are touched, and only those. One that would now land somewhere else — or nowhere — such
 * as a link to one of two same-named headings whose order flipped. And a NESTED path that named the heading's
 * real ancestors and no longer does: `[[note#A#A1]]` once `A1` moved under `B`. That second kind is not
 * broken as far as Obsidian is concerned — measured on 1.13, `resolveSubpath` matches the segments in
 * document order without checking nesting, so `#A#A1` still reaches `A1` sitting under `B` — but the link
 * now states a structure the note no longer has, and the next `A1` added under `A` would silently take it
 * over. A plain `[[note#Heading]]` to a unique heading names no ancestors, so it is left exactly as written.
 *
 * The new subpath is built from the heading's new ancestor path, trying the same number of segments the
 * link had first, then more, then fewer, and is kept only once Obsidian's own resolution confirms it
 * reaches the moved heading.
 *
 * @param params - The parameters.
 * @returns The new subpath (with its leading `#`), or `null` when the link needs no change or no subpath
 * reaches the heading.
 */
export function resolveReorderedHeadingSubpath(params: ResolveReorderedHeadingSubpathParams): null | string {
  const { newHeadingPaths, oldHeadingPaths, resolveNewHeadingIndex, resolveOldHeadingIndex, subpath, toNewHeadingIndex } = params;
  if (!subpath.startsWith('#')) {
    return null;
  }

  const segments = subpath.slice(1).split('#');
  if (segments.some((segment) => segment.startsWith('^'))) {
    return null;
  }

  const oldHeadingIndex = resolveOldHeadingIndex(subpath);
  const newHeadingIndex = oldHeadingIndex === null ? null : toNewHeadingIndex(oldHeadingIndex);
  if (oldHeadingIndex === null || newHeadingIndex === null) {
    return null;
  }

  const newHeadingPath = newHeadingPaths[newHeadingIndex] ?? [];
  const isStillReached = resolveNewHeadingIndex(subpath) === newHeadingIndex;
  const didStopNamingAncestors = isAncestorPath(segments, oldHeadingPaths[oldHeadingIndex] ?? [])
    && !isAncestorPath(segments, newHeadingPath);
  if (isStillReached && !didStopNamingAncestors) {
    return null;
  }

  const path = newHeadingPath.map((heading) => sanitizeHeadingForSubpath(heading));
  const preferredLength = Math.min(segments.length, path.length);
  const lengths = [
    ...Array.from({ length: path.length - preferredLength + 1 }, (_, offset) => preferredLength + offset),
    ...Array.from({ length: preferredLength - 1 }, (_, offset) => preferredLength - 1 - offset)
  ];
  for (const length of lengths) {
    const candidate = `#${path.slice(-length).join('#')}`;
    if (resolveNewHeadingIndex(candidate) === newHeadingIndex) {
      return candidate;
    }
  }

  return null;
}

/**
 * Rewrites every link to a reordered note's headings that the reorder would otherwise break — the note's
 * own links included, since Obsidian counts them among its backlinks (issue #295). See
 * {@link resolveReorderedHeadingSubpath} for which links change and to what.
 *
 * A note whose heading count changed between the two caches is left alone: the positional mapping from old
 * to new heading would then point at the wrong heading, and a wrong link is worse than a stale one.
 *
 * @param params - The parameters.
 * @returns The number of links rewritten.
 */
export async function updateReorderedHeadingLinks(params: UpdateReorderedHeadingLinksParams): Promise<number> {
  const oldHeadings = params.oldCache.headings ?? [];
  const newHeadings = params.newCache.headings ?? [];
  if (oldHeadings.length !== newHeadings.length) {
    return 0;
  }

  const newHeadingPaths = buildNewHeadingPaths(params.split, params.order);
  const oldHeadingPaths = buildHeadingPathsFromCache(oldHeadings);
  // Collected in a `const` array (not a reassigned counter) so the converter closure records rewrites safely.
  const rewrittenLinks: (string | undefined)[] = [];
  await editBacklinks({
    abortSignal: params.abortSignal,
    app: params.app,
    linkConverter: (link) => {
      const { linkPath, subpath } = splitSubpath(link.link);
      const newSubpath = resolveReorderedHeadingSubpath({
        newHeadingPaths,
        oldHeadingPaths,
        resolveNewHeadingIndex: (candidate) => resolveHeadingIndex(params.newCache, newHeadings, candidate),
        resolveOldHeadingIndex: (candidate) => resolveHeadingIndex(params.oldCache, oldHeadings, candidate),
        subpath,
        toNewHeadingIndex: (oldHeadingIndex) => toIndexOrNull(params.order.indexOf(oldHeadingIndex))
      });
      if (newSubpath === null) {
        return;
      }

      const rewritten = replaceLinkUrl(link, linkPath + newSubpath);
      rewrittenLinks.push(rewritten);
      return rewritten;
    },
    pathOrFile: params.path,
    pluginNoticeComponent: params.pluginNoticeComponent,
    resourceLockComponent: params.resourceLockComponent
  });

  // A backlink is internal by definition, so `replaceLinkUrl` never declines one; counted defensively anyway.
  return rewrittenLinks.filter((rewritten) => rewritten !== undefined).length;
}

/**
 * Builds each heading's ancestor path from a heading cache, nesting the way Obsidian's outline does: a
 * heading's parent is the nearest heading above it of a lower level.
 *
 * @param headings - The heading cache entries, in document order.
 * @returns The heading texts from the top-level ancestor down, per heading position.
 */
function buildHeadingPathsFromCache(headings: readonly HeadingCache[]): string[][] {
  const stack: HeadingPathStackEntry[] = [];
  return headings.map((heading) => {
    while ((stack.at(-1)?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    const path = [...(stack.at(-1)?.path ?? []), heading.heading];
    stack.push({ level: heading.level, path });
    return path;
  });
}

/**
 * Builds each heading's ancestor path in the confirmed tree, indexed by its position in the reordered note.
 *
 * @param split - The split note, holding the confirmed tree.
 * @param order - The confirmed order.
 * @returns The heading texts from the top-level ancestor down, per new heading position.
 */
function buildNewHeadingPaths(split: SplitReorderableSectionsResult, order: readonly number[]): string[][] {
  const paths: string[][] = [];
  visit(split.roots, []);
  return paths;

  function visit(nodes: readonly HeadingTreeNode[], ancestorPath: readonly string[]): void {
    for (const node of nodes) {
      // Every node indexes a section of the same split, so a fallback would be a branch nothing can reach.
      // The text is the one the heading WILL have, so a renumbered heading is re-pathed too.
      const path = [...ancestorPath, ensureNonNullable(split.headingTexts[node.index])];
      paths[order.indexOf(node.index)] = path;
      visit(node.children, path);
    }
  }
}

/**
 * Whether a subpath's segments name a heading through its real ancestors: the last segment is the heading
 * itself and the ones before it are ancestors of it, in order, any of them skippable — `#A#C` names `C`
 * under `A` under nothing, whether or not a `B` sits between them.
 *
 * @param segments - The subpath's segments.
 * @param headingPath - The heading's path, top-level ancestor first.
 * @returns Whether the segments follow that path.
 */
function isAncestorPath(segments: readonly string[], headingPath: readonly string[]): boolean {
  const normalizedPath = headingPath.map((heading) => normalizeHeadingForComparison(heading));
  const normalizedSegments = segments.map((segment) => normalizeHeadingForComparison(segment));
  if (normalizedSegments.at(-1) !== normalizedPath.at(-1)) {
    return false;
  }

  let pathPosition = 0;
  for (const segment of normalizedSegments.slice(0, -1)) {
    const found = normalizedPath.indexOf(segment, pathPosition);
    if (found === -1 || found >= normalizedPath.length - 1) {
      return false;
    }
    pathPosition = found + 1;
  }
  return true;
}

function resolveHeadingIndex(cache: CachedMetadata, headings: readonly HeadingCache[], subpath: string): null | number {
  const result = resolveSubpath(cache, subpath);
  if (result?.type !== 'heading') {
    return null;
  }

  const offset = result.current.position.start.offset;
  return toIndexOrNull(headings.findIndex((heading) => heading.position.start.offset === offset));
}

function toIndexOrNull(index: number): null | number {
  return index === -1 ? null : index;
}
