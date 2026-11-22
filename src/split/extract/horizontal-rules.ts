import type {
  App,
  CachedMetadata,
  Editor,
  EditorPosition,
  TFile
} from 'obsidian';

/**
 * The longest note name {@link resolveHorizontalRuleBlockName} derives from a block's first line. A first
 * line is often a whole paragraph, and a file name that long is useless in a file explorer.
 */
const MAX_BLOCK_NAME_LENGTH = 100;

/**
 * The `SectionCache.type` value Obsidian assigns to a horizontal rule (thematic break). It covers every
 * CommonMark thematic-break spelling — `---`, `***`, `___`, and their spaced / longer variants — while
 * frontmatter delimiters and `---` inside code fences are parsed as other section types, so relying on it
 * avoids a fragile regex and the "conflict with properties" problem.
 */
const THEMATIC_BREAK_SECTION_TYPE = 'thematicBreak';

/**
 * One block of a note cut at its horizontal rules, with the name `Split note by horizontal rules` gives the
 * note it becomes.
 */
export interface HorizontalRuleBlock extends HorizontalRuleSelection {
  /**
   * The text of the block's first heading, else its first line with its markdown markup removed, cut to
   * {@link MAX_BLOCK_NAME_LENGTH} characters. Empty when neither yields any text.
   */
  readonly name: string;
}

/**
 * The two editor reads {@link getHorizontalRuleBlocks} needs, so it can be fed an editor or plain lines.
 */
export interface HorizontalRuleBlockLineSource {
  readonly getLine: (line: number) => string;
  readonly lineCount: () => number;
}

export interface HorizontalRuleSelection {
  readonly end: EditorPosition;
  readonly start: EditorPosition;
}

interface GetHorizontalRuleBlocksParams {
  readonly cache: CachedMetadata;
  readonly lines: HorizontalRuleBlockLineSource;
}

interface GetSelectionBetweenHorizontalRulesParams {
  readonly app: App;
  readonly editor: Editor;
  readonly file: TFile;
  readonly lineNumber: number;
}

/**
 * Cuts a note at its horizontal rules: every block of content between two rules, or between a rule and the
 * start or end of the note, in document order. The frontmatter is never part of a block, the rules
 * themselves are excluded, leading and trailing blank lines are trimmed, and a block holding nothing but
 * blank lines is dropped. Returns an empty list when the note has no horizontal rule, since a note with none
 * is one block that a split would only move whole.
 *
 * Backs `Split note by horizontal rules`, the batch sibling of `Extract between horizontal rules`.
 */
export function getHorizontalRuleBlocks(params: GetHorizontalRuleBlocksParams): HorizontalRuleBlock[] {
  const { cache, lines } = params;
  const rules = (cache.sections ?? [])
    .filter((section) => section.type === THEMATIC_BREAK_SECTION_TYPE)
    .sort((a, b) => a.position.start.line - b.position.start.line);
  if (rules.length === 0) {
    return [];
  }

  const firstContentLine = cache.frontmatterPosition ? cache.frontmatterPosition.end.line + 1 : 0;
  const lastLine = lines.lineCount() - 1;
  const ranges: [number, number][] = [];
  let startLine = firstContentLine;
  for (const rule of rules) {
    if (rule.position.start.line >= firstContentLine) {
      ranges.push([startLine, rule.position.start.line - 1]);
    }
    startLine = Math.max(startLine, rule.position.end.line + 1);
  }
  ranges.push([startLine, lastLine]);

  const blocks: HorizontalRuleBlock[] = [];
  for (const [rangeStartLine, rangeEndLine] of ranges) {
    let blockStartLine = rangeStartLine;
    let blockEndLine = rangeEndLine;
    while (blockStartLine <= blockEndLine && !lines.getLine(blockStartLine).trim()) {
      blockStartLine++;
    }
    while (blockEndLine >= blockStartLine && !lines.getLine(blockEndLine).trim()) {
      blockEndLine--;
    }
    if (blockStartLine > blockEndLine) {
      continue;
    }

    const heading = (cache.headings ?? []).find((headingCache) => headingCache.position.start.line >= blockStartLine && headingCache.position.start.line <= blockEndLine);
    blocks.push({
      end: {
        ch: lines.getLine(blockEndLine).length,
        line: blockEndLine
      },
      name: heading ? heading.heading.trim() : resolveHorizontalRuleBlockName(lines.getLine(blockStartLine)),
      start: {
        ch: 0,
        line: blockStartLine
      }
    });
  }
  return blocks;
}

/**
 * Resolves the range of content between the horizontal rules closest to `lineNumber`, using the document's
 * start/end as implicit boundaries. The bounding rules themselves are excluded from the range, and leading /
 * trailing blank lines are trimmed. Returns `null` when the note has no horizontal rules, or when the
 * resolved section has no non-blank content (e.g. two adjacent rules) — in which case the command is
 * disabled for that cursor position.
 *
 * When the cursor sits on a rule line, that rule is treated as the top boundary (the section below it is
 * selected).
 */
export function getSelectionBetweenHorizontalRules(
  params: GetSelectionBetweenHorizontalRulesParams
): HorizontalRuleSelection | null {
  const {
    app,
    editor,
    file,
    lineNumber
  } = params;

  const cache = app.metadataCache.getFileCache(file);
  if (!cache) {
    return null;
  }

  const rules = (cache.sections ?? [])
    .filter((section) => section.type === THEMATIC_BREAK_SECTION_TYPE)
    .sort((a, b) => a.position.start.line - b.position.start.line);
  if (rules.length === 0) {
    return null;
  }

  const lastLine = editor.lineCount() - 1;

  let startLine: number;
  let nextRule = null;

  const onRule = rules.find((rule) => lineNumber >= rule.position.start.line && lineNumber <= rule.position.end.line);
  if (onRule) {
    startLine = onRule.position.end.line + 1;
    nextRule = rules.find((rule) => rule.position.start.line > onRule.position.end.line) ?? null;
  } else {
    let previousRule = null;
    for (const rule of rules) {
      if (rule.position.end.line < lineNumber) {
        previousRule = rule;
      } else if (!nextRule && rule.position.start.line > lineNumber) {
        nextRule = rule;
      }
    }
    startLine = previousRule ? previousRule.position.end.line + 1 : 0;
  }

  let endLine = nextRule ? nextRule.position.start.line - 1 : lastLine;

  // Trim leading and trailing blank lines so the extracted block and the residual source stay clean.
  while (startLine < endLine && !editor.getLine(startLine).trim()) {
    startLine++;
  }
  while (endLine > startLine && !editor.getLine(endLine).trim()) {
    endLine--;
  }

  // Nothing but blank lines between the rules -> nothing to extract.
  if (startLine > endLine || !editor.getLine(startLine).trim()) {
    return null;
  }

  return {
    end: {
      ch: editor.getLine(endLine).length,
      line: endLine
    },
    start: {
      ch: 0,
      line: startLine
    }
  };
}

/**
 * Derives a note name from a block's first line when the block has no heading: list, quote, task and heading
 * markers and emphasis are dropped, a link is reduced to the text it shows, and the result is cut to
 * {@link MAX_BLOCK_NAME_LENGTH} characters at the last word boundary that fits.
 */
export function resolveHorizontalRuleBlockName(line: string): string {
  const text = line
    .replace(/^\s*(?:>\s*)*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replaceAll(/!?\[\[[^\]|]*\|(?<alias>[^\]]*)\]\]/g, '$<alias>')
    .replaceAll(/!?\[\[(?<target>[^\]]*)\]\]/g, '$<target>')
    .replaceAll(/!?\[(?<text>[^\]]*)\]\([^)]*\)/g, '$<text>')
    .replaceAll(/[*_~`=]+/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_BLOCK_NAME_LENGTH) {
    return text;
  }
  const cut = text.slice(0, MAX_BLOCK_NAME_LENGTH);
  const lastSpaceIndex = cut.lastIndexOf(' ');
  return (lastSpaceIndex > 0 ? cut.slice(0, lastSpaceIndex) : cut).trim();
}
