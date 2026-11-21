import type {
  App as AppOriginal,
  CachedMetadata,
  ReferenceCache,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  analyzeAttachmentNote,
  appendBlockId,
  findAttachmentNoteReference,
  findBlockEndLine,
  findParentCandidates,
  findReferencesToNote,
  generateBlockId,
  isLinkToRewrite,
  pickMainReference
} from './inline-attachment-note.ts';

interface ReferenceParams {
  readonly line?: number;
  readonly link: string;
  readonly original?: string;
  readonly startOffset?: number;
}

function createApp(files: Record<string, string>): AppOriginal {
  return App.createConfigured__({ files }).asOriginalType__();
}

function getFile(app: AppOriginal, path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

function position(startLine: number, endLine = startLine): ReferenceCache['position'] {
  return { end: { col: 0, line: endLine, offset: 0 }, start: { col: 0, line: startLine, offset: 0 } };
}

function reference(params: ReferenceParams): ReferenceCache {
  const line = params.line ?? 0;
  const startOffset = params.startOffset ?? 0;
  const original = params.original ?? `[[${params.link}]]`;
  return {
    link: params.link,
    original,
    position: {
      end: { col: original.length, line, offset: startOffset + original.length },
      start: { col: 0, line, offset: startOffset }
    }
  };
}

const app = createApp({
  'Docs/Invoice.md': 'body',
  'Docs/parent.md': 'body',
  'other.md': 'body',
  'pic.png': 'P',
  'sketch.excalidraw.md': 'drawing'
});
const noteFile = getFile(app, 'Docs/Invoice.md');
const parentFile = getFile(app, 'Docs/parent.md');

describe('findAttachmentNoteReference', () => {
  function find(cache: CachedMetadata): null | string {
    return findAttachmentNoteReference({ app, attachmentExtensions: ['.excalidraw.md'], cache, noteFile })?.attachment.path ?? null;
  }

  it('should find the one attachment reference, an embed, a link or a markdown-shaped attachment', () => {
    expect(find({ embeds: [reference({ link: 'pic.png' })] })).toBe('pic.png');
    expect(find({ links: [reference({ link: 'pic.png' })] })).toBe('pic.png');
    expect(find({ embeds: [reference({ link: 'sketch.excalidraw.md' })] })).toBe('sketch.excalidraw.md');
  });

  it('should refuse a note with no reference, several references, or one to a note or to nothing', () => {
    expect(find({})).toBeNull();
    expect(find({ embeds: [reference({ link: 'pic.png' })], links: [reference({ link: 'other' })] })).toBeNull();
    expect(find({ links: [reference({ link: 'other' })] })).toBeNull();
    expect(find({ links: [reference({ link: 'missing.png' })] })).toBeNull();
  });
});

describe('analyzeAttachmentNote', () => {
  const EMBED = '![[pic.png]]';

  function analyze(content: string, frontmatter: CachedMetadata['frontmatter'], original = EMBED, file = noteFile): ReturnType<typeof analyzeAttachmentNote> {
    const cache: CachedMetadata = { embeds: [reference({ link: 'pic.png', original, startOffset: content.indexOf(original) })], ...frontmatter && { frontmatter } };
    return analyzeAttachmentNote({ app, attachmentExtensions: [], cache, content, noteFile: file });
  }

  it('should carry the first alias as link text and drop nothing else from a plain attachment note', () => {
    const content = `---\naliases:\n  - March invoice\n---\n\n${EMBED}\n`;
    expect(analyze(content, { aliases: ['March invoice'] })).toEqual({
      attachment: getFile(app, 'pic.png'),
      droppedAliases: [],
      droppedProperties: [],
      droppedText: '',
      isEmbed: true,
      linkText: 'March invoice'
    });
  });

  it('should list the remaining aliases, the other properties and the other text as dropped', () => {
    const content = `---\naliases: [March invoice, Scan, pic]\ntags: [x]\n---\nIntro\n\n${EMBED}\nTail\n`;
    const analysis = analyze(content, { aliases: ['March invoice', ' Scan ', 'pic', ''], tags: ['x'] });
    expect(analysis?.droppedAliases).toEqual(['Scan']);
    expect(analysis?.droppedProperties).toEqual(['tags']);
    expect(analysis?.droppedText).toBe('Intro\n\n\nTail');
  });

  it('should fall back to the note name, then to the note\'s own link text', () => {
    expect(analyze(`${EMBED}\n`, undefined)?.linkText).toBe('Invoice');
    // An alias that only repeats the file name is no link text.
    expect(analyze(`${EMBED}\n`, { aliases: ['pic.png'] })?.linkText).toBe('Invoice');
    const picNote = getFile(createApp({ 'pic.md': 'body', 'pic.png': 'P' }), 'pic.md');
    expect(analyze('![[pic.png|300]]\n', undefined, '![[pic.png|300]]', picNote)?.linkText).toBe('300');
    expect(analyze('[[pic.png]]\n', undefined, '[[pic.png]]', picNote)).toMatchObject({ isEmbed: false, linkText: null });
    // A reference whose text is not link syntax, as the cache can record for an autolinked path.
    expect(analyze('pic.png\n', undefined, 'pic.png', picNote)).toMatchObject({ isEmbed: false, linkText: null });
  });

  it('should refuse a note that is not an attachment note', () => {
    expect(analyzeAttachmentNote({ app, attachmentExtensions: [], cache: {}, content: '', noteFile })).toBeNull();
  });
});

describe('appendBlockId', () => {
  it('should append the block id to the line', () => {
    expect(appendBlockId({ blockId: 'abc123', content: 'a\n- ![[pic.png|x]]  \nb', line: 1 })).toBe('a\n- ![[pic.png|x]] ^abc123\nb');
  });

  it('should fail on a line the note does not have', () => {
    expect(() => appendBlockId({ blockId: 'abc123', content: 'a', line: 3 })).toThrow('no line 3');
  });
});

describe('findBlockEndLine', () => {
  it('should take the innermost list item, then the section, then the line itself', () => {
    const cache = castTo<CachedMetadata>({
      listItems: [{ position: position(0, 4) }, { position: position(1, 2) }, { position: position(6) }],
      sections: [{ position: position(0, 6) }, { position: position(8, 10) }]
    });
    expect(findBlockEndLine(cache, 1)).toBe(2);
    expect(findBlockEndLine(cache, 3)).toBe(4);
    expect(findBlockEndLine(cache, 9)).toBe(10);
    expect(findBlockEndLine(cache, 12)).toBe(12);
    expect(findBlockEndLine({}, 5)).toBe(5);
  });
});

describe('findReferencesToNote and pickMainReference', () => {
  const second = reference({ link: 'Invoice', original: '![[Invoice]]', startOffset: 30 });
  const first = reference({ link: 'Invoice', startOffset: 10 });
  const cache: CachedMetadata = { embeds: [second], links: [reference({ link: 'other' }), first] };

  it('should list the references to the note in document order', () => {
    expect(findReferencesToNote({ app, cache, noteFile, sourceFile: parentFile })).toEqual([first, second]);
  });

  it('should prefer the first embed, then the first link', () => {
    expect(pickMainReference([first, second])).toBe(second);
    expect(pickMainReference([first])).toBe(first);
    expect(pickMainReference([])).toBeNull();
  });
});

describe('findParentCandidates', () => {
  it('should list every other note whose body links the note, sorted by path', () => {
    const files: Record<string, TFile> = {
      'a.md': castTo<TFile>({ path: 'a.md' }),
      'Docs/parent.md': parentFile,
      'frontmatter.md': getFile(app, 'other.md'),
      'z.md': castTo<TFile>({ path: 'z.md' })
    };
    const caches: Record<string, CachedMetadata> = {
      'a.md': { links: [reference({ link: 'Invoice' })] },
      'Docs/parent.md': { links: [reference({ line: 4, link: 'Invoice' })], listItems: castTo<NonNullable<CachedMetadata['listItems']>>([{ position: position(1) }, { position: position(4) }]) },
      'z.md': { links: [reference({ link: 'Docs/Invoice' })] }
    };
    const candidateApp = castTo<AppOriginal>({
      metadataCache: {
        getFileCache: (file: TFile) => caches[file.path === 'other.md' ? 'frontmatter.md' : file.path] ?? {},
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own member name.
        getFirstLinkpathDest: (link: string) => link.endsWith('Invoice') ? noteFile : null,
        resolvedLinks: {
          'a.md': { 'Docs/Invoice.md': 1 },
          'Docs/Invoice.md': { 'Docs/Invoice.md': 1 },
          'Docs/parent.md': { 'Docs/Invoice.md': 1 },
          'frontmatter.md': { 'Docs/Invoice.md': 1 },
          'gone.md': { 'Docs/Invoice.md': 1 },
          'unrelated.md': { 'pic.png': 1 },
          'z.md': { 'Docs/Invoice.md': 2 }
        }
      },
      vault: { getFileByPath: (path: string) => files[path] ?? null }
    });

    expect(findParentCandidates(candidateApp, noteFile).map(({ file, isFromList }) => `${file.path}:${String(isFromList)}`)).toEqual(['Docs/parent.md:true', 'a.md:false', 'z.md:false']);
  });
});

describe('generateBlockId', () => {
  it('should skip ids too short or already taken', () => {
    const values = [0.5, 0.123456789, 0.987654321];
    function random(): number {
      return values.shift() ?? 0;
    }
    const taken = 0.123456789.toString(36).slice(2, 8);
    expect(generateBlockId(new Set([taken]), random)).toBe(0.987654321.toString(36).slice(2, 8));
  });

  it('should default to Math.random', () => {
    expect(generateBlockId(new Set())).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe('isLinkToRewrite', () => {
  const mainReference = reference({ link: 'Invoice', startOffset: 10 });

  function isRewritten(sourcePath: string, startOffset: null | number): boolean {
    const link = startOffset === null ? { key: 'related', link: 'Invoice', original: '[[Invoice]]' } : reference({ link: 'Invoice', startOffset });
    return isLinkToRewrite({ mainReference, notePath: noteFile.path, parentPath: parentFile.path, reference: link, sourcePath });
  }

  it('should rewrite every link but the parent\'s main reference and the note\'s own', () => {
    expect(isRewritten(parentFile.path, 10)).toBe(false);
    expect(isRewritten(noteFile.path, 0)).toBe(false);
    expect(isRewritten(parentFile.path, 40)).toBe(true);
    expect(isRewritten(parentFile.path, null)).toBe(true);
    expect(isRewritten('other.md', 10)).toBe(true);
  });
});
