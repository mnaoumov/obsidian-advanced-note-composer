import type {
  App,
  Editor,
  EditorPosition,
  TFile
} from 'obsidian';

/**
 * The `SectionCache.type` value Obsidian assigns to a horizontal rule (thematic break). It covers every
 * CommonMark thematic-break spelling — `---`, `***`, `___`, and their spaced / longer variants — while
 * frontmatter delimiters and `---` inside code fences are parsed as other section types, so relying on it
 * avoids a fragile regex and the "conflict with properties" problem.
 */
const THEMATIC_BREAK_SECTION_TYPE = 'thematicBreak';

export interface HorizontalRuleSelection {
  readonly end: EditorPosition;
  readonly start: EditorPosition;
}

interface GetSelectionBetweenHorizontalRulesParams {
  readonly app: App;
  readonly editor: Editor;
  readonly file: TFile;
  readonly lineNumber: number;
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
  let endLine: number;

  const onRule = rules.find((rule) => lineNumber >= rule.position.start.line && lineNumber <= rule.position.end.line);
  if (onRule) {
    startLine = onRule.position.end.line + 1;
    const nextRule = rules.find((rule) => rule.position.start.line > onRule.position.end.line);
    endLine = nextRule ? nextRule.position.start.line - 1 : lastLine;
  } else {
    let prevRule = null;
    let nextRule = null;
    for (const rule of rules) {
      if (rule.position.end.line < lineNumber) {
        prevRule = rule;
      } else if (!nextRule && rule.position.start.line > lineNumber) {
        nextRule = rule;
      }
    }
    startLine = prevRule ? prevRule.position.end.line + 1 : 0;
    endLine = nextRule ? nextRule.position.start.line - 1 : lastLine;
  }

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
