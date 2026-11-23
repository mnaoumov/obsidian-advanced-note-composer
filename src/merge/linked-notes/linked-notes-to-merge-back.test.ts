import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  findLinkedNotesToMergeBack,
  hasLinkedNoteCandidate,
  replaceSourceLinksWithTokens
} from './linked-notes-to-merge-back.ts';

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mnaoumov/obsidian-lib/metadata-cache')>();
  return { ...original, getCacheSafe: vi.fn(original.getCacheSafe) };
});

interface Fixture {
  readonly app: AppOriginal;
  readonly targetFile: TFile;
}

function createFixture(targetContent: string): Fixture {
  const app = App.createConfigured__({
    files: {
      'a.md': '# A\n\nbody a',
      'b.md': 'body b',
      'c.md': 'body c',
      'image.png': '',
      'target.md': targetContent
    }
  }).asOriginalType__();
  return { app, targetFile: ensureNonNullable(app.vault.getFileByPath('target.md')) };
}

function getFile(app: AppOriginal, path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

describe('findLinkedNotesToMergeBack', () => {
  it('should find every note linked or embedded on a line of its own, in line order', async () => {
    const { app, targetFile } = createFixture('intro\n![[b]]\ntext\n[[a]]\n');
    const linkedNotes = await findLinkedNotesToMergeBack({ app, isIgnored: () => false, targetFile });
    expect(linkedNotes.map((linkedNote) => [linkedNote.file.path, linkedNote.link.line])).toEqual([['b.md', 1], ['a.md', 3]]);
  });

  it('should leave alone a subpath link, a link in a sentence, a note linked twice, an attachment and the note itself', async () => {
    const { app, targetFile } = createFixture('[[a#A]]\nsee [[b]] here\n[[c]]\n[[c]]\n[[image.png]]\n[[target]]\n[[missing]]');
    expect(await findLinkedNotesToMergeBack({ app, isIgnored: () => false, targetFile })).toEqual([]);
  });

  it('should leave alone a note the path settings exclude', async () => {
    const { app, targetFile } = createFixture('[[a]]\n[[b]]');
    const linkedNotes = await findLinkedNotesToMergeBack({ app, isIgnored: (file) => file.path === 'a.md', targetFile });
    expect(linkedNotes.map((linkedNote) => linkedNote.file.path)).toEqual(['b.md']);
  });

  it('should find nothing for a note with no metadata cache', async () => {
    const { app, targetFile } = createFixture('[[a]]');
    vi.mocked(getCacheSafe).mockResolvedValueOnce(null);
    expect(await findLinkedNotesToMergeBack({ app, isIgnored: () => false, targetFile })).toEqual([]);
  });
});

describe('hasLinkedNoteCandidate', () => {
  it('should be true when the note links another markdown note without a subpath', () => {
    const { app, targetFile } = createFixture('see [[a]]');
    expect(hasLinkedNoteCandidate({ app, targetFile })).toBe(true);
  });

  it('should be false when the note links only attachments, subpaths, itself or nothing that exists', () => {
    const { app, targetFile } = createFixture('![[image.png]] [[a#A]] [[target]] [[missing]]');
    expect(hasLinkedNoteCandidate({ app, targetFile })).toBe(false);
  });

  it('should be false when the note has no metadata cache', () => {
    const { app, targetFile } = createFixture('[[a]]');
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValueOnce(null);
    expect(hasLinkedNoteCandidate({ app, targetFile })).toBe(false);
  });
});

describe('replaceSourceLinksWithTokens', () => {
  it('should swap each link for its own token in one write', async () => {
    const { app, targetFile } = createFixture('intro\n[[a]]\nmiddle\n![[b]]\noutro');
    const vaultTransaction = new VaultTransaction({ app });
    const tokens = await replaceSourceLinksWithTokens({
      app,
      shouldMergeHeadings: false,
      sourceFiles: [getFile(app, 'a.md'), getFile(app, 'b.md')],
      targetFile,
      vaultTransaction
    });
    await vaultTransaction.commit();
    const tokenA = ensureNonNullable(tokens.get(getFile(app, 'a.md')));
    const tokenB = ensureNonNullable(tokens.get(getFile(app, 'b.md')));
    expect(tokenA).not.toBe(tokenB);
    expect(await app.vault.read(targetFile)).toBe(`intro\n${tokenA}\nmiddle\n${tokenB}\noutro`);
  });

  it('should take the heading above a link along when headings merge and the note opens with it (issue #314)', async () => {
    const { app, targetFile } = createFixture('intro\n\n# A\n\n[[a]]\n');
    const vaultTransaction = new VaultTransaction({ app });
    const tokens = await replaceSourceLinksWithTokens({
      app,
      shouldMergeHeadings: true,
      sourceFiles: [getFile(app, 'a.md')],
      targetFile,
      vaultTransaction
    });
    await vaultTransaction.commit();
    expect(await app.vault.read(targetFile)).toBe(`intro\n\n${ensureNonNullable(tokens.get(getFile(app, 'a.md')))}\n`);
  });

  it('should keep the heading when headings do not merge', async () => {
    const { app, targetFile } = createFixture('# A\n[[a]]');
    const vaultTransaction = new VaultTransaction({ app });
    const tokens = await replaceSourceLinksWithTokens({
      app,
      shouldMergeHeadings: false,
      sourceFiles: [getFile(app, 'a.md')],
      targetFile,
      vaultTransaction
    });
    await vaultTransaction.commit();
    expect(await app.vault.read(targetFile)).toBe(`# A\n${ensureNonNullable(tokens.get(getFile(app, 'a.md')))}`);
  });

  it('should throw when the target no longer links a note on a line of its own', async () => {
    const { app, targetFile } = createFixture('see [[a]] here');
    await expect(replaceSourceLinksWithTokens({
      app,
      shouldMergeHeadings: false,
      sourceFiles: [getFile(app, 'a.md')],
      targetFile,
      vaultTransaction: new VaultTransaction({ app })
    })).rejects.toThrow('target.md no longer links a.md on a line of its own.');
  });
});
