import type { FrontMatterInfo } from 'obsidian';

import {
  getFrontMatterInfo,
  parseYaml
} from 'obsidian';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { Selection } from './composers/composer-base.ts';

/**
 * Parameters for {@link extractFrontmatterSelection}.
 */
export interface ExtractFrontmatterSelectionParams {
  /**
   * The source note's content.
   */
  readonly content: string;

  /**
   * The selections being extracted, as offsets into {@link ExtractFrontmatterSelectionParams.content}.
   */
  readonly selections: readonly Selection[];
}

/**
 * A selection that lies entirely inside a note's frontmatter block, resolved into the properties it names
 * and the YAML the source note is left with.
 */
export interface FrontmatterSelectionExtraction {
  /**
   * The YAML to merge into the target note — the selected lines plus the ancestor key lines they sit under,
   * so a selection of two `aliases` items arrives as `aliases` rather than as two loose scalars.
   */
  readonly extractedYaml: string;

  /**
   * The end of the source note's frontmatter YAML, excluding the closing `---` fence.
   */
  readonly frontmatterEndOffset: number;

  /**
   * The start of the source note's frontmatter YAML, excluding the opening `---` fence.
   */
  readonly frontmatterStartOffset: number;

  /**
   * What replaces `[frontmatterStartOffset, frontmatterEndOffset]` in the source note: the same YAML with
   * the extracted lines deleted. Everything else survives byte-for-byte — comments, key order, quoting and
   * indentation style — which re-serializing the parsed block would not.
   */
  readonly remainingYaml: string;
}

/**
 * One line of a note's frontmatter YAML, with the offsets it occupies in the note and the few shape facts
 * the extraction reasons about.
 */
interface FrontmatterLine {
  readonly endOffset: number;

  /**
   * How many characters of leading whitespace the line has, i.e. its YAML nesting level.
   */
  readonly indent: number;
  readonly isBlank: boolean;
  readonly isComment: boolean;

  /**
   * Whether the line is a key with nothing after its colon (`aliases:`) — the shape that owns the lines
   * below it.
   */
  readonly isEmptyValueKey: boolean;
  readonly isSequenceItem: boolean;
  readonly startOffset: number;
  readonly text: string;
}

const COMMENT_REG_EXP = /^\s*#/;
const EMPTY_VALUE_KEY_REG_EXP = /:\s*$/;
const SEQUENCE_ITEM_REG_EXP = /^\s*-(?:\s|$)/;

/**
 * The line-level machinery behind {@link extractFrontmatterSelection}, grouped so the line table and the
 * parent-of-each-line map are shared state instead of being threaded through every helper.
 */
class FrontmatterSelectionExtractor {
  private readonly frontmatterInfo: FrontMatterInfo;
  private readonly lines: readonly FrontmatterLine[];

  /**
   * The key line each line belongs to. A line with no entry has no parent (a top-level property); blank
   * and comment lines are left out entirely, so a comment can neither become an ancestor nor keep an
   * emptied key line alive.
   */
  private readonly parentIndexes = new Map<number, number>();

  public constructor(content: string) {
    this.frontmatterInfo = getFrontMatterInfo(content);
    this.lines = buildFrontmatterLines(this.frontmatterInfo);

    for (const [index, line] of this.lines.entries()) {
      if (line.isBlank || line.isComment) {
        continue;
      }

      const parentIndex = this.resolveParentIndex(index);
      if (parentIndex !== null) {
        this.parentIndexes.set(index, parentIndex);
      }
    }
  }

  public extract(selections: readonly Selection[]): FrontmatterSelectionExtraction | null {
    if (!this.frontmatterInfo.exists) {
      return null;
    }

    // The whole selection must sit inside the YAML region. Its end is measured from the block's own text
    // Rather than from `to`, so the region this returns and the lines it was built from cannot disagree.
    const frontmatterEndOffset = this.frontmatterInfo.from + this.frontmatterInfo.frontmatter.length;
    const isEverySelectionInsideFrontmatter = selections.every((selection) => selection.startOffset >= this.frontmatterInfo.from && selection.endOffset <= frontmatterEndOffset);
    if (!isEverySelectionInsideFrontmatter) {
      return null;
    }

    const selectedIndexes = this.collectSelectedIndexes(selections);
    if (selectedIndexes.size === 0) {
      return null;
    }

    const extractedYaml = this.joinLines(this.addAncestors(selectedIndexes));
    if (!checkIsPropertyMap(safeParseYaml(extractedYaml))) {
      return null;
    }

    return {
      extractedYaml,
      frontmatterEndOffset,
      frontmatterStartOffset: this.frontmatterInfo.from,
      remainingYaml: this.joinLines(this.resolveRemainingIndexes(selectedIndexes))
    };
  }

  /**
   * Adds the ancestor key lines of every selected line, so the extracted YAML is a well-formed document
   * rather than a set of orphaned values.
   *
   * @param selectedIndexes - The selected lines.
   * @returns The lines to extract.
   */
  private addAncestors(selectedIndexes: ReadonlySet<number>): ReadonlySet<number> {
    const extractedIndexes = new Set(selectedIndexes);
    for (const selectedIndex of selectedIndexes) {
      let parentIndex = this.parentIndexes.get(selectedIndex);
      while (parentIndex !== undefined) {
        extractedIndexes.add(parentIndex);
        parentIndex = this.parentIndexes.get(parentIndex);
      }
    }

    return extractedIndexes;
  }

  /**
   * Decides whether a line is a key line the extraction emptied — it owns lines below it, and every one of
   * them is gone. Such a line is removed too, so the source is not left with a dangling `aliases:`.
   *
   * @param index - The line to check.
   * @param remainingIndexes - The lines the source keeps so far.
   * @returns Whether the line is now an emptied key line.
   */
  private checkIsEmptiedKeyLine(index: number, remainingIndexes: ReadonlySet<number>): boolean {
    if (!this.getLine(index).isEmptyValueKey) {
      return false;
    }

    const hadChildren = [...this.parentIndexes.values()].includes(index);
    if (!hadChildren) {
      return false;
    }

    return ![...this.parentIndexes.entries()].some(([childIndex, parentIndex]) => parentIndex === index && remainingIndexes.has(childIndex));
  }

  /**
   * Resolves the lines the selection covers. A line the selection touches at all is taken in full — the
   * reporter's own gesture starts mid-value — while a blank line is never taken, so a selection of nothing
   * but whitespace is not a property selection.
   *
   * @param selections - The selections being extracted.
   * @returns The selected lines.
   */
  private collectSelectedIndexes(selections: readonly Selection[]): ReadonlySet<number> {
    const selectedIndexes = new Set<number>();
    for (const [index, line] of this.lines.entries()) {
      if (line.isBlank) {
        continue;
      }

      const isSelected = selections.some((selection) => selection.startOffset < line.endOffset && line.startOffset < selection.endOffset);
      if (isSelected) {
        selectedIndexes.add(index);
      }
    }

    return selectedIndexes;
  }

  private getLine(index: number): FrontmatterLine {
    return ensureNonNullable(this.lines[index]);
  }

  private joinLines(indexes: ReadonlySet<number>): string {
    return this.lines.filter((_line, index) => indexes.has(index)).map((line) => line.text).join('\n');
  }

  /**
   * Resolves the key line a line belongs to: the nearest line above it at a smaller indent, or — for a
   * sequence item — a key line at its OWN indent, since both `aliases:\n  - a` and `aliases:\n- a` are
   * valid YAML and a note can hold either. Blank and comment lines are looked past.
   *
   * @param index - The line to resolve the parent of.
   * @returns The parent line, or `null` for a top-level line.
   */
  private resolveParentIndex(index: number): null | number {
    const line = this.getLine(index);
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex--) {
      const candidate = this.getLine(candidateIndex);
      if (candidate.isBlank || candidate.isComment) {
        continue;
      }

      if (candidate.indent < line.indent) {
        return candidateIndex;
      }

      if (candidate.indent === line.indent && line.isSequenceItem && !candidate.isSequenceItem && candidate.isEmptyValueKey) {
        return candidateIndex;
      }
    }

    return null;
  }

  /**
   * Resolves the lines the source note keeps: everything the selection did not cover, minus the key lines
   * the removal emptied. Repeated to a fixed point so a nested map collapses upwards.
   *
   * @param selectedIndexes - The selected lines.
   * @returns The lines the source keeps.
   */
  private resolveRemainingIndexes(selectedIndexes: ReadonlySet<number>): ReadonlySet<number> {
    const remainingIndexes = new Set(this.lines.map((_line, index) => index).filter((index) => !selectedIndexes.has(index)));
    for (;;) {
      const emptiedIndex = [...remainingIndexes].find((index) => this.checkIsEmptiedKeyLine(index, remainingIndexes));
      if (emptiedIndex === undefined) {
        return remainingIndexes;
      }

      remainingIndexes.delete(emptiedIndex);
    }
  }
}

/**
 * Resolves a selection that lies entirely inside the note's frontmatter block into the properties it names
 * (issue #183), so an extract can route it through the frontmatter merge strategy instead of pasting raw
 * YAML lines into the target note's body.
 *
 * Every frontmatter line the selection touches is taken IN FULL, together with the ancestor key lines it
 * sits under — the selection is a set of VALUES, so the key each value belongs to has to be re-emitted with
 * it. Returns `null` whenever the selection is not a frontmatter-only selection of properties (no
 * frontmatter, a selection reaching outside the block, a selection of nothing, or lines that do not parse
 * into YAML properties), and the caller then extracts the raw text exactly as before.
 *
 * @param params - The parameters.
 * @returns The extraction, or `null` when this is not a frontmatter-only property selection.
 */
export function extractFrontmatterSelection(params: ExtractFrontmatterSelectionParams): FrontmatterSelectionExtraction | null {
  return new FrontmatterSelectionExtractor(params.content).extract(params.selections);
}

function buildFrontmatterLines(frontmatterInfo: FrontMatterInfo): FrontmatterLine[] {
  const lines: FrontmatterLine[] = [];
  let startOffset = frontmatterInfo.from;
  for (const text of frontmatterInfo.frontmatter.split('\n')) {
    const endOffset = startOffset + text.length;
    lines.push({
      endOffset,
      indent: text.length - text.trimStart().length,
      isBlank: text.trim() === '',
      isComment: COMMENT_REG_EXP.test(text),
      isEmptyValueKey: EMPTY_VALUE_KEY_REG_EXP.test(text),
      isSequenceItem: SEQUENCE_ITEM_REG_EXP.test(text),
      startOffset,
      text
    });
    startOffset = endOffset + 1;
  }

  return lines;
}

function checkIsPropertyMap(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function safeParseYaml(yaml: string): unknown {
  try {
    return parseYaml(yaml);
  } catch {
    return null;
  }
}
