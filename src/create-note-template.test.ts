import type {
  TFile,
  TFolder
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  describe,
  expect,
  it
} from 'vitest';

import { resolveTemplateTail } from './create-note-template.ts';

const FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';

function createFile(path: string, parentFolderName: string): TFile {
  const segments = path.split('/');
  return strictProxy<TFile>({
    basename: ensureNonNullable(segments.at(-1)).replace(/\.md$/, ''),
    parent: strictProxy<TFolder>({ name: parentFolderName, path: segments.slice(0, -1).join('/') }),
    path
  });
}

const sourceFile = createFile('Projects/Source Note.md', 'Projects');
const targetFile = createFile('Archive/Target Note.md', 'Archive');

describe('resolveTemplateTail', () => {
  function resolve(template: string, source: null | TFile = sourceFile): string {
    return resolveTemplateTail({
      folderNameTemplate: FOLDER_NAME_TEMPLATE,
      sourceFile: source,
      targetFile,
      template
    });
  }

  it('should return what follows the content token', () => {
    expect(resolve('# Heading\n\n{{content}}\n\nfooter')).toBe('\n\nfooter');
  });

  it('should resolve the tokens the tail itself carries', () => {
    expect(resolve('{{content}}\n\nFrom [[{{fromTitle}}]] into {{newTitle}}')).toBe('\n\nFrom [[Source Note]] into Target Note');
  });

  it('should return nothing when the template ends at the content token', () => {
    expect(resolve('---\ntag: inbox\n---\n\n{{content}}')).toBe('');
  });

  it('should recognize the content token whatever its case', () => {
    expect(resolve('{{Content}}tail')).toBe('tail');
  });

  // The caret goes at the first `{{content}}`; a second one is still a content token and still resolves to
  // Nothing, so the tail it leaves behind is `bc`.
  it('should split at the FIRST content token', () => {
    expect(resolve('a{{content}}b{{content}}c')).toBe('bc');
  });

  it('should ignore tokens that merely start with the content key', () => {
    expect(resolve('{{contentType}}', null)).toBe('');
  });

  // Unreachable through the settings UI — the `splitTemplate` validator refuses a non-empty template with
  // No `{{content}}` — so this is what a hand-edited `data.json` gets: the caret at the end of the note.
  it('should return nothing when the template has no content token at all', () => {
    expect(resolve('# Just a heading')).toBe('');
  });

  it('should resolve a tail with no source note', () => {
    expect(resolve('{{content}}[{{fromTitle}}]', null)).toBe('[]');
  });
});
