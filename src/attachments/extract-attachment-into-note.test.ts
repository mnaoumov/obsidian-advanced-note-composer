import type {
  App as AppOriginal,
  CachedMetadata,
  ReferenceCache,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildAttachmentNoteContent,
  countReferences,
  findAttachmentReferenceAtCursor,
  findBlockIdOnLine,
  isAttachment,
  isLinkToBlock,
  removeBlockId,
  replaceReference,
  resolveAttachmentName
} from './extract-attachment-into-note.ts';

interface ReferenceParams {
  readonly endCol: number;
  readonly endLine?: number;
  readonly link: string;
  readonly original?: string;
  readonly startCol: number;
  readonly startLine?: number;
  readonly startOffset?: number;
}

function createApp(files: Record<string, string>): AppOriginal {
  return App.createConfigured__({ files }).asOriginalType__();
}

function getFile(app: AppOriginal, path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

function reference(params: ReferenceParams): ReferenceCache {
  const startLine = params.startLine ?? 0;
  const startOffset = params.startOffset ?? 0;
  const original = params.original ?? `[[${params.link}]]`;
  return {
    link: params.link,
    original,
    position: {
      end: { col: params.endCol, line: params.endLine ?? startLine, offset: startOffset + original.length },
      start: { col: params.startCol, line: startLine, offset: startOffset }
    }
  };
}

describe('buildAttachmentNoteContent', () => {
  it('should write only the embed when there is no alias', () => {
    expect(buildAttachmentNoteContent([], '![[pic.png]]')).toBe('![[pic.png]]\n');
  });

  it('should write the aliases as quoted list items above the embed', () => {
    expect(buildAttachmentNoteContent(['March "invoice"'], '![[pic.png]]')).toBe('---\naliases:\n  - "March \\"invoice\\""\n---\n\n![[pic.png]]\n');
  });
});

describe('countReferences', () => {
  it('should count references from every note, and none to an unreferenced file', () => {
    // The mocks do not index `resolvedLinks`, so the map is written out by hand.
    const app = castTo<AppOriginal>({
      metadataCache: {
        resolvedLinks: {
          'a.md': { 'pic.png': 2 },
          'b.md': { 'note.md': 1, 'pic.png': 1 }
        }
      }
    });

    expect(countReferences(app, strictProxy<TFile>({ path: 'pic.png' }))).toBe(3);
    expect(countReferences(app, strictProxy<TFile>({ path: 'other.png' }))).toBe(0);
  });
});

describe('findAttachmentReferenceAtCursor', () => {
  const app = createApp({
    'a.png': 'A',
    'b.png': 'B',
    'note.md': 'body',
    'other.md': 'body',
    'sketch.excalidraw.md': 'drawing'
  });
  const noteFile = getFile(app, 'note.md');

  function find(cache: CachedMetadata, line: number, ch: number): null | string {
    const found = findAttachmentReferenceAtCursor({ app, attachmentExtensions: ['.excalidraw.md'], cache, ch, line, noteFile });
    return found ? `${found.attachment.path}@${String(found.reference.position.start.col)}` : null;
  }

  it('should find nothing in a note without references', () => {
    expect(find({}, 0, 0)).toBeNull();
  });

  it('should take the reference under the cursor when the line holds several', () => {
    const cache: CachedMetadata = {
      embeds: [reference({ endCol: 10, link: 'a.png', startCol: 2 })],
      links: [reference({ endCol: 30, link: 'b.png', startCol: 20 })]
    };

    expect(find(cache, 0, 25)).toBe('b.png@20');
    expect(find(cache, 0, 2)).toBe('a.png@2');
    expect(find(cache, 0, 10)).toBe('a.png@2');
  });

  it('should refuse to guess between several references when the cursor is on neither', () => {
    const cache: CachedMetadata = {
      links: [reference({ endCol: 10, link: 'a.png', startCol: 2 }), reference({ endCol: 30, link: 'b.png', startCol: 20 })]
    };

    expect(find(cache, 0, 15)).toBeNull();
  });

  it('should take the only attachment reference on the line wherever the cursor is', () => {
    const cache: CachedMetadata = {
      links: [reference({ endCol: 10, link: 'other', startCol: 2 }), reference({ endCol: 30, link: 'a.png', startCol: 20 })]
    };

    expect(find(cache, 0, 0)).toBe('a.png@20');
  });

  it('should skip references on other lines, unresolved links and notes', () => {
    const cache: CachedMetadata = {
      links: [
        reference({ endCol: 10, link: 'a.png', startCol: 2, startLine: 1 }),
        reference({ endCol: 10, link: 'missing.png', startCol: 2, startLine: 3 }),
        reference({ endCol: 10, link: 'other', startCol: 2, startLine: 3 })
      ]
    };

    expect(find(cache, 0, 5)).toBeNull();
    expect(find(cache, 2, 5)).toBeNull();
    expect(find(cache, 3, 5)).toBeNull();
  });

  it('should take a markdown-shaped attachment', () => {
    const cache: CachedMetadata = { embeds: [reference({ endCol: 22, link: 'sketch.excalidraw', startCol: 0 })] };

    expect(find(cache, 0, 1)).toBe('sketch.excalidraw.md@0');
  });

  it('should find a reference spanning several lines from any of them', () => {
    const cache: CachedMetadata = {
      links: [
        reference({ endCol: 4, endLine: 3, link: 'a.png', original: '[a\n\n\nb](a.png)', startCol: 10, startLine: 1 }),
        reference({ endCol: 30, endLine: 2, link: 'b.png', startCol: 20, startLine: 2 })
      ]
    };

    expect(find(cache, 2, 0)).toBe('a.png@10');
  });
});

describe('findBlockIdOnLine', () => {
  const cache = castTo<CachedMetadata>({
    blocks: {
      inv: { id: 'inv', position: { end: { col: 30, line: 4, offset: 0 }, start: { col: 0, line: 2, offset: 0 } } }
    }
  });

  it('should find the block holding the line', () => {
    expect(findBlockIdOnLine(cache, 2)).toBe('inv');
    expect(findBlockIdOnLine(cache, 4)).toBe('inv');
  });

  it('should find nothing outside any block, or in a note without blocks', () => {
    expect(findBlockIdOnLine(cache, 1)).toBeNull();
    expect(findBlockIdOnLine(cache, 5)).toBeNull();
    expect(findBlockIdOnLine({}, 0)).toBeNull();
  });
});

describe('isAttachment', () => {
  const app = createApp({
    'a.base': '',
    'a.canvas': '{}',
    'a.md': '',
    'a.png': 'A',
    'sketch.excalidraw.md': ''
  });

  it('should tell attachments from notes', () => {
    const attachmentExtensions = ['.excalidraw.md'];
    expect(isAttachment({ attachmentExtensions, file: getFile(app, 'a.png') })).toBe(true);
    expect(isAttachment({ attachmentExtensions, file: getFile(app, 'sketch.excalidraw.md') })).toBe(true);
    expect(isAttachment({ attachmentExtensions, file: getFile(app, 'a.md') })).toBe(false);
    expect(isAttachment({ attachmentExtensions, file: getFile(app, 'a.canvas') })).toBe(false);
    expect(isAttachment({ attachmentExtensions, file: getFile(app, 'a.base') })).toBe(false);
  });
});

describe('isLinkToBlock', () => {
  it('should match exactly that block', () => {
    expect(isLinkToBlock(reference({ endCol: 0, link: 'parent#^inv', startCol: 0 }), 'inv')).toBe(true);
    expect(isLinkToBlock(reference({ endCol: 0, link: 'parent#^invoice', startCol: 0 }), 'inv')).toBe(false);
    expect(isLinkToBlock(reference({ endCol: 0, link: 'parent', startCol: 0 }), 'inv')).toBe(false);
  });
});

describe('removeBlockId', () => {
  it('should drop the block id and the spaces before and after it', () => {
    expect(removeBlockId({ blockId: 'inv', content: 'a\n- [[x]] ^inv  \nb', line: 1 })).toBe('a\n- [[x]]\nb');
  });

  it('should leave a line that does not end with the block id', () => {
    const content = 'a\n- [[x]] ^other\nb';
    expect(removeBlockId({ blockId: 'inv', content, line: 1 })).toBe(content);
  });

  it('should leave the content when the line is gone', () => {
    expect(removeBlockId({ blockId: 'inv', content: 'a', line: 5 })).toBe('a');
  });
});

describe('replaceReference', () => {
  const content = 'See ![[pic.png|March]] here';
  const ref = reference({ endCol: 22, link: 'pic.png', original: '![[pic.png|March]]', startCol: 4, startOffset: 4 });

  it('should replace the reference at its position', () => {
    expect(replaceReference({ content, newLink: '[[March]]', reference: ref })).toBe('See [[March]] here');
  });

  it('should refuse when the content moved under the cached position', () => {
    expect(() => replaceReference({ content: `x${content}`, newLink: '[[March]]', reference: ref })).toThrow('The note changed');
  });
});

describe('resolveAttachmentName', () => {
  const app = createApp({ 'scan.pdf': 'PDF' });
  const attachment = getFile(app, 'scan.pdf');

  function resolve(original: string): ReturnType<typeof resolveAttachmentName> {
    return resolveAttachmentName(reference({ endCol: 0, link: 'scan.pdf', original, startCol: 0 }), attachment);
  }

  it('should take the link text as the name', () => {
    expect(resolve('![[scan.pdf| March invoice ]]')).toEqual({ isFromLinkText: true, name: 'March invoice' });
    expect(resolve('[March invoice](scan.pdf)')).toEqual({ isFromLinkText: true, name: 'March invoice' });
  });

  it('should fall back to the file name without link text, for a size, or for the file name itself', () => {
    const fileName = { isFromLinkText: false, name: 'scan' };
    expect(resolve('![[scan.pdf]]')).toEqual(fileName);
    expect(resolve('![[scan.pdf|300]]')).toEqual(fileName);
    expect(resolve('![[scan.pdf|300x200]]')).toEqual(fileName);
    expect(resolve('[scan.pdf](scan.pdf)')).toEqual(fileName);
    expect(resolve('[scan](scan.pdf)')).toEqual(fileName);
    expect(resolve('not a link')).toEqual(fileName);
  });
});
