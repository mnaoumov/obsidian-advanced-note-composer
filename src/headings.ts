import type { Editor } from 'obsidian';

export function extractHeading(editor: Editor): string {
  const selectedLines = editor.getSelection().split('\n');
  if (selectedLines.length > 0) {
    const extractedHeading = extractHeadingFromLine(selectedLines[0] ?? '');
    return extractedHeading ?? '';
  }

  return '';
}

export function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}
