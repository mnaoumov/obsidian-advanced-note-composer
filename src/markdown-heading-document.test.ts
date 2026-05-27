import type { App } from 'obsidian';

import { parseMetadata } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { InsertMode } from './insert-mode.ts';
import { parseMarkdownHeadingDocument } from './markdown-heading-document.ts';

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  parseMetadata: vi.fn()
}));

const mockParseMetadata = vi.mocked(parseMetadata);

function createMockApp(): App {
  return strictProxy<App>({});
}

describe('parseMarkdownHeadingDocument', () => {
  it('should parse simple document without headings', async () => {
    mockParseMetadata.mockResolvedValue({
      headings: []
    });

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, 'Hello World');
    expect(doc.toString()).toBe('Hello World');
  });

  it('should parse document with frontmatter', async () => {
    const content = '---\ntitle: Test\n---\nHello World';
    mockParseMetadata.mockResolvedValue({
      frontmatterPosition: {
        end: { col: 0, line: 2, offset: 18 },
        start: { col: 0, line: 0, offset: 0 }
      },
      headings: []
    });

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, content);
    expect(doc.toString()).toBe(content);
  });

  it('should parse document with single heading', async () => {
    const content = '## Heading\nContent under heading';
    mockParseMetadata.mockResolvedValue({
      headings: [
        {
          heading: 'Heading',
          level: 2,
          position: {
            end: { col: 10, line: 0, offset: 10 },
            start: { col: 0, line: 0, offset: 0 }
          }
        }
      ]
    });

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, content);
    expect(doc.toString()).toBe(content);
  });

  it('should parse document with multiple headings at same level', async () => {
    const content = '## First\nContent 1\n## Second\nContent 2';
    mockParseMetadata.mockResolvedValue({
      headings: [
        {
          heading: 'First',
          level: 2,
          position: {
            end: { col: 8, line: 0, offset: 8 },
            start: { col: 0, line: 0, offset: 0 }
          }
        },
        {
          heading: 'Second',
          level: 2,
          position: {
            end: { col: 9, line: 2, offset: 28 },
            start: { col: 0, line: 2, offset: 19 }
          }
        }
      ]
    });

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, content);
    expect(doc.toString()).toBe(content);
  });

  it('should parse document with nested headings', async () => {
    const content = '# Parent\nParent text\n## Child\nChild text';
    mockParseMetadata.mockResolvedValue({
      headings: [
        {
          heading: 'Parent',
          level: 1,
          position: {
            end: { col: 8, line: 0, offset: 8 },
            start: { col: 0, line: 0, offset: 0 }
          }
        },
        {
          heading: 'Child',
          level: 2,
          position: {
            end: { col: 8, line: 2, offset: 29 },
            start: { col: 0, line: 2, offset: 21 }
          }
        }
      ]
    });

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, content);
    expect(doc.toString()).toBe(content);
  });

  it('should handle null headings from metadata', async () => {
    mockParseMetadata.mockResolvedValue({});

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, 'No headings');
    expect(doc.toString()).toBe('No headings');
  });
});

describe('MarkdownHeadingDocument.mergeWith', () => {
  it('should merge documents with append mode', async () => {
    mockParseMetadata.mockResolvedValueOnce({
      headings: []
    });
    mockParseMetadata.mockResolvedValueOnce({
      headings: []
    });

    const app = createMockApp();
    const doc1 = await parseMarkdownHeadingDocument(app, 'Content A');
    const doc2 = await parseMarkdownHeadingDocument(app, '\nContent B');

    const merged = doc1.mergeWith(doc2, InsertMode.Append);
    expect(merged.toString()).toBe('Content A\nContent B');
  });

  it('should merge documents with prepend mode', async () => {
    mockParseMetadata.mockResolvedValueOnce({
      headings: []
    });
    mockParseMetadata.mockResolvedValueOnce({
      headings: []
    });

    const app = createMockApp();
    const doc1 = await parseMarkdownHeadingDocument(app, 'Content A');
    const doc2 = await parseMarkdownHeadingDocument(app, 'Content B\n');

    const merged = doc1.mergeWith(doc2, InsertMode.Prepend);
    expect(merged.toString()).toBe('Content B\nContent A');
  });

  it('should merge documents with matching headings', async () => {
    const contentA = '# Title\nText A\n## Sub\nSub A';
    mockParseMetadata.mockResolvedValueOnce({
      headings: [
        {
          heading: 'Title',
          level: 1,
          position: {
            end: { col: 7, line: 0, offset: 7 },
            start: { col: 0, line: 0, offset: 0 }
          }
        },
        {
          heading: 'Sub',
          level: 2,
          position: {
            end: { col: 5, line: 2, offset: 20 },
            start: { col: 0, line: 2, offset: 15 }
          }
        }
      ]
    });

    const contentB = '# Title\nText B\n## Sub\nSub B';
    mockParseMetadata.mockResolvedValueOnce({
      headings: [
        {
          heading: 'Title',
          level: 1,
          position: {
            end: { col: 7, line: 0, offset: 7 },
            start: { col: 0, line: 0, offset: 0 }
          }
        },
        {
          heading: 'Sub',
          level: 2,
          position: {
            end: { col: 5, line: 2, offset: 20 },
            start: { col: 0, line: 2, offset: 15 }
          }
        }
      ]
    });

    const app = createMockApp();
    const doc1 = await parseMarkdownHeadingDocument(app, contentA);
    const doc2 = await parseMarkdownHeadingDocument(app, contentB);

    const merged = doc1.mergeWith(doc2, InsertMode.Append);
    const result = merged.toString();
    expect(result).toContain('# Title');
    expect(result).toContain('Text A');
    expect(result).toContain('Text B');
    expect(result).toContain('## Sub');
    expect(result).toContain('Sub A');
    expect(result).toContain('Sub B');
  });

  it('should add non-matching sub-headings from merged document', async () => {
    const contentA = '# Title\nText A';
    mockParseMetadata.mockResolvedValueOnce({
      headings: [
        {
          heading: 'Title',
          level: 1,
          position: {
            end: { col: 7, line: 0, offset: 7 },
            start: { col: 0, line: 0, offset: 0 }
          }
        }
      ]
    });

    const contentB = '# Title\nText B\n## NewSub\nNew Sub Content';
    mockParseMetadata.mockResolvedValueOnce({
      headings: [
        {
          heading: 'Title',
          level: 1,
          position: {
            end: { col: 7, line: 0, offset: 7 },
            start: { col: 0, line: 0, offset: 0 }
          }
        },
        {
          heading: 'NewSub',
          level: 2,
          position: {
            end: { col: 8, line: 2, offset: 23 },
            start: { col: 0, line: 2, offset: 15 }
          }
        }
      ]
    });

    const app = createMockApp();
    const doc1 = await parseMarkdownHeadingDocument(app, contentA);
    const doc2 = await parseMarkdownHeadingDocument(app, contentB);

    const merged = doc1.mergeWith(doc2, InsertMode.Append);
    const result = merged.toString();
    expect(result).toContain('# Title');
    expect(result).toContain('Text A');
    expect(result).toContain('Text B');
    expect(result).toContain('## NewSub');
    expect(result).toContain('New Sub Content');
  });
});

describe('MarkdownHeadingDocument.wrapText', () => {
  it('should transform text in all nodes', async () => {
    const content = '# Heading\nSome text';
    mockParseMetadata.mockResolvedValue({
      headings: [
        {
          heading: 'Heading',
          level: 1,
          position: {
            end: { col: 9, line: 0, offset: 9 },
            start: { col: 0, line: 0, offset: 0 }
          }
        }
      ]
    });

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, content);

    await doc.wrapText((text) => text.toUpperCase());
    const result = doc.toString();
    expect(result).toContain('\nSOME TEXT');
  });

  it('should handle async text transformation', async () => {
    const content = 'Simple text';
    mockParseMetadata.mockResolvedValue({
      headings: []
    });

    const app = createMockApp();
    const doc = await parseMarkdownHeadingDocument(app, content);

    await doc.wrapText(async (text) => Promise.resolve(`wrapped(${text})`));
    expect(doc.toString()).toBe('wrapped(Simple text)');
  });
});
