import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  findHeadingAboveResidualLink,
  findResidualSourceLink
} from './residual-source-link.ts';

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mnaoumov/obsidian-lib/metadata-cache')>();
  return { ...original, getCacheSafe: vi.fn(original.getCacheSafe) };
});

interface Fixture {
  readonly app: AppOriginal;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
}

function createFixture(targetContent: string, sourceContent = 'source body'): Fixture {
  const app = App.createConfigured__({
    files: {
      'source.md': sourceContent,
      'target.md': targetContent
    }
  }).asOriginalType__();
  return {
    app,
    sourceFile: ensureNonNullable(app.vault.getFileByPath('source.md')),
    targetFile: ensureNonNullable(app.vault.getFileByPath('target.md'))
  };
}

async function find(targetContent: string, overrideContent = targetContent): Promise<ReturnType<typeof findResidualSourceLink>> {
  const { app, sourceFile, targetFile } = createFixture(targetContent);
  return findResidualSourceLink({ app, sourceFile, targetContent: overrideContent, targetFile });
}

describe('findResidualSourceLink', () => {
  it('should find a sole link alone on its line', async () => {
    expect(await find('before\n[[source]]\nafter')).toEqual({
      endOffset: 17,
      line: 1,
      original: '[[source]]',
      startOffset: 7
    });
  });

  it('should find a sole embed on the last line, surrounded by whitespace', async () => {
    const result = await find('before\n  ![[source]]  ');
    expect(result?.original).toBe('![[source]]');
    expect(result?.line).toBe(1);
  });

  it('should answer null when the link sits inside a sentence', async () => {
    expect(await find('see [[source]] here')).toBeNull();
  });

  it('should answer null when the target references the source twice', async () => {
    expect(await find('[[source]]\n![[source]]')).toBeNull();
  });

  it('should answer null when the target does not reference the source', async () => {
    expect(await find('[[other]]')).toBeNull();
  });

  it('should answer null for a heading link', async () => {
    expect(await find('[[source#Heading]]')).toBeNull();
  });

  it('should answer null when the content no longer matches the cache', async () => {
    expect(await find('[[source]]', '[[other]]!')).toBeNull();
  });

  it('should answer null when merging a note into itself', async () => {
    const { app, sourceFile } = createFixture('');
    expect(await findResidualSourceLink({ app, sourceFile, targetContent: 'source body', targetFile: sourceFile })).toBeNull();
  });

  it('should answer null for a target that has no metadata cache', async () => {
    const { app, sourceFile, targetFile } = createFixture('[[source]]');
    vi.mocked(getCacheSafe).mockResolvedValueOnce(null);
    expect(await findResidualSourceLink({ app, sourceFile, targetContent: '[[source]]', targetFile })).toBeNull();
  });
});

async function findHeading(targetContent: string, sourceContent: string): Promise<null | number> {
  const { app, sourceFile, targetFile } = createFixture(targetContent, sourceContent);
  const residualLink = ensureNonNullable(await findResidualSourceLink({ app, sourceFile, targetContent, targetFile }));
  return findHeadingAboveResidualLink({ app, residualLink, sourceFile, targetContent, targetFile });
}

describe('findHeadingAboveResidualLink', () => {
  it('should find the heading the link sits right under when the source opens with the same heading', async () => {
    expect(await findHeading('intro\n\n## Example\n\n[[source]]\n', '## Example\n\nbody')).toBe(7);
  });

  it('should look past the source frontmatter', async () => {
    expect(await findHeading('## Example\n[[source]]', '---\nkey: value\n---\n## Example\nbody')).toBe(0);
  });

  it('should answer null when text sits between the heading and the link', async () => {
    expect(await findHeading('## Example\ntext\n[[source]]', '## Example\nbody')).toBeNull();
  });

  it('should answer null when no heading is above the link', async () => {
    expect(await findHeading('[[source]]\n## Example', '## Example\nbody')).toBeNull();
  });

  it('should answer null when the source opens with a different heading text', async () => {
    expect(await findHeading('## Example\n[[source]]', '## Other\nbody')).toBeNull();
  });

  it('should answer null when the source opens with a heading of another level', async () => {
    expect(await findHeading('## Example\n[[source]]', '### Example\nbody')).toBeNull();
  });

  it('should answer null when the source does not open with a heading', async () => {
    expect(await findHeading('## Example\n[[source]]', 'body\n\n## Example')).toBeNull();
  });

  it('should answer null when the source has no headings at all', async () => {
    expect(await findHeading('## Example\n[[source]]', 'body')).toBeNull();
  });

  it('should answer null when either note has no metadata cache', async () => {
    const targetContent = '## Example\n[[source]]';
    const { app, sourceFile, targetFile } = createFixture(targetContent, '## Example\nbody');
    const residualLink = ensureNonNullable(await findResidualSourceLink({ app, sourceFile, targetContent, targetFile }));
    vi.mocked(getCacheSafe).mockResolvedValueOnce(null);
    expect(await findHeadingAboveResidualLink({ app, residualLink, sourceFile, targetContent, targetFile })).toBeNull();
    const targetCache = await getCacheSafe(app, targetFile);
    vi.mocked(getCacheSafe).mockResolvedValueOnce(targetCache).mockResolvedValueOnce(null);
    expect(await findHeadingAboveResidualLink({ app, residualLink, sourceFile, targetContent, targetFile })).toBeNull();
  });
});
