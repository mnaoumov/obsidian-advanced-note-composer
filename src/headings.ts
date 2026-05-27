import type { Editor } from 'obsidian';

export function extractHeading(editor: Editor): string {
  const selectedLines = editor.getSelection().split('\n');
  /* v8 ignore start -- split('\n') always returns at least one element. */
  if (selectedLines.length > 0) {
    /* v8 ignore stop */
    /* v8 ignore start -- selectedLines[0] is always defined when length > 0. */
    const extractedHeading = extractHeadingFromLine(selectedLines[0] ?? '');
    /* v8 ignore stop */
    return extractedHeading ?? '';
  }

  /* v8 ignore start -- unreachable dead code after split('\n'). */
  return '';
  /* v8 ignore stop */
}

export function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}
