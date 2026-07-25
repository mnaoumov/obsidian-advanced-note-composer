import type { HeadingCache } from 'obsidian';

/**
 * A reorderable top-level section of a note: its heading text/level plus the full slice of note content
 * it owns (the heading line and everything under it, including any nested subheadings, up to the next
 * top-level heading).
 */
export interface HeadingSection {
  /**
   * The heading text (without the leading `#`s).
   */
  readonly headingText: string;

  /**
   * The heading level (the shallowest level present in the note).
   */
  readonly level: number;

  /**
   * The full section content: the heading line and its body up to the next top-level heading.
   */
  readonly text: string;
}

/**
 * The result of splitting a note into a fixed preamble plus its reorderable top-level sections.
 */
export interface SplitReorderableSectionsResult {
  /**
   * The content before the first top-level heading, kept in place (never reordered).
   */
  readonly preamble: string;

  /**
   * The reorderable top-level sections, in document order.
   */
  readonly sections: HeadingSection[];
}

/**
 * Counts the reorderable top-level sections — the headings at the shallowest level present in the note.
 * Deeper (nested) headings do not add sections; they travel with their top-level parent.
 *
 * @param headings - The note's heading cache entries.
 * @returns The number of top-level sections.
 */
export function countReorderableSections(headings: readonly HeadingCache[]): number {
  if (headings.length === 0) {
    return 0;
  }
  const minLevel = getMinLevel(headings);
  return headings.filter((heading) => heading.level === minLevel).length;
}

/**
 * Rebuilds a note's content from a reordered permutation of its top-level sections. The preamble stays
 * first; the sections are emitted in `order`, each trimmed of trailing whitespace and separated by a
 * single blank line (inter-section spacing is normalized), with a trailing newline. Nested subheadings
 * inside a section travel with it. Any out-of-range index in `order` is skipped defensively.
 *
 * @param split - The split note (preamble + sections).
 * @param order - A permutation of section indices giving the new order.
 * @returns The rebuilt note content.
 */
export function joinReorderedSections(split: SplitReorderableSectionsResult, order: readonly number[]): string {
  const parts: string[] = [];
  const preamble = split.preamble.trimEnd();
  if (preamble !== '') {
    parts.push(preamble);
  }
  for (const index of order) {
    const section = split.sections[index];
    if (section) {
      parts.push(section.text.trimEnd());
    }
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * Splits a note into its fixed preamble and its reorderable top-level sections. Each top-level section
 * spans from its heading to the next top-level heading (or the end of the note), so any nested
 * subheadings are kept inside their parent section.
 *
 * @param content - The full note content.
 * @param headings - The note's heading cache entries.
 * @returns The preamble and the ordered top-level sections.
 */
export function splitIntoReorderableSections(content: string, headings: readonly HeadingCache[]): SplitReorderableSectionsResult {
  if (headings.length === 0) {
    return { preamble: content, sections: [] };
  }
  const minLevel = getMinLevel(headings);
  const topHeadings = headings.filter((heading) => heading.level === minLevel);
  const sections: HeadingSection[] = [];
  let preamble = content;
  for (const [i, heading] of topHeadings.entries()) {
    const start = heading.position.start.offset;
    if (i === 0) {
      preamble = content.slice(0, start);
    }
    const nextHeading = topHeadings[i + 1];
    const end = nextHeading ? nextHeading.position.start.offset : content.length;
    sections.push({
      headingText: heading.heading,
      level: minLevel,
      text: content.slice(start, end)
    });
  }
  return { preamble, sections };
}

function getMinLevel(headings: readonly HeadingCache[]): number {
  return Math.min(...headings.map((heading) => heading.level));
}
