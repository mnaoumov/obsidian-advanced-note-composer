import type {
  App as AppOriginal,
  Reference
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { getBacklinksForFileSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  rewriteHeadingLink,
  rewriteHeadingSubpath,
  updateHeadingBacklinks
} from './rename-heading.ts';

interface MetadataCacheWithCompute {
  computeMetadataAsync(): void;
}

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>()),
  getBacklinksForFileSafe: vi.fn()
}));

function reference(original: string, link: string): Reference {
  return castTo<Reference>({ link, original });
}

describe('rewriteHeadingSubpath', () => {
  it('should rewrite the heading at the start of a nested subpath', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Parent', subpath: '#Parent#Child' })).toBe('#New#Child');
  });

  it('should rewrite the heading in the middle of a nested subpath', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Middle', subpath: '#Top#Middle#Leaf' })).toBe('#Top#New#Leaf');
  });

  it('should rewrite the heading at the end of a nested subpath', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Leaf', subpath: '#Top#Leaf' })).toBe('#Top#New');
  });

  it('should rewrite a single-segment subpath', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Parent', subpath: '#Parent' })).toBe('#New');
  });

  it('should rewrite every occurrence of a repeated heading', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Same', subpath: '#Same#Other#Same' })).toBe('#New#Other#New');
  });

  it('should match the heading case-insensitively', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'parent', subpath: '#PARENT#Child' })).toBe('#New#Child');
  });

  it('should match a heading with characters Obsidian strips when normalizing', () => {
    // Obsidian normalizes `.`/`,`/etc. to spaces when matching a heading in a subpath.
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'A. B', subpath: '#A  B#Child' })).toBe('#New#Child');
  });

  it('should sanitize characters that would break the subpath out of the new heading', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New: Heading | X', oldHeading: 'Old', subpath: '#Old' })).toBe('#New Heading X');
  });

  it('should leave a block-reference segment untouched', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: '^abc', subpath: '#^abc' })).toBeNull();
  });

  it('should leave a block reference untouched even when the heading matches another segment', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Parent', subpath: '#Parent#^abc' })).toBe('#New#^abc');
  });

  it('should return null when no segment matches', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Missing', subpath: '#Parent#Child' })).toBeNull();
  });

  it('should return null for an empty subpath', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: 'Parent', subpath: '' })).toBeNull();
  });

  it('should return null when the old heading normalizes to empty', () => {
    expect(rewriteHeadingSubpath({ newHeading: 'New', oldHeading: '###', subpath: '#Parent' })).toBeNull();
  });
});

describe('rewriteHeadingLink', () => {
  it('should rewrite a nested wikilink', () => {
    expect(rewriteHeadingLink({ link: reference('[[target#Parent#Child]]', 'target#Parent#Child'), newHeading: 'New', oldHeading: 'Parent' })).toBe('[[target#New#Child]]');
  });

  it('should rewrite a single-segment wikilink', () => {
    expect(rewriteHeadingLink({ link: reference('[[target#Parent]]', 'target#Parent'), newHeading: 'New', oldHeading: 'Parent' })).toBe('[[target#New]]');
  });

  it('should preserve a wikilink alias', () => {
    expect(rewriteHeadingLink({ link: reference('[[target#Parent#Child|Shown]]', 'target#Parent#Child'), newHeading: 'New', oldHeading: 'Parent' })).toBe('[[target#New#Child|Shown]]');
  });

  it('should preserve an embed', () => {
    expect(rewriteHeadingLink({ link: reference('![[target#Parent]]', 'target#Parent'), newHeading: 'New', oldHeading: 'Parent' })).toBe('![[target#New]]');
  });

  it('should preserve the folder path of a wikilink', () => {
    expect(rewriteHeadingLink({ link: reference('[[folder/target#Parent#Child]]', 'folder/target#Parent#Child'), newHeading: 'New', oldHeading: 'Parent' })).toBe('[[folder/target#New#Child]]');
  });

  it('should rewrite and re-encode a markdown link', () => {
    expect(rewriteHeadingLink({ link: reference('[md](target.md#Parent%20Child)', 'target.md#Parent Child'), newHeading: 'New Name', oldHeading: 'Parent Child' })).toBe('[md](target.md#New%20Name)');
  });

  it('should preserve angle brackets of a markdown link', () => {
    expect(rewriteHeadingLink({ link: reference('[md](<target.md#Parent Child>)', 'target.md#Parent Child'), newHeading: 'New Name', oldHeading: 'Parent Child' })).toBe('[md](<target.md#New Name>)');
  });

  it('should return undefined for a block reference', () => {
    expect(rewriteHeadingLink({ link: reference('[[target#^abc]]', 'target#^abc'), newHeading: 'New', oldHeading: 'abc' })).toBeUndefined();
  });

  it('should return undefined for a link without a matching subpath', () => {
    expect(rewriteHeadingLink({ link: reference('[[target#Other]]', 'target#Other'), newHeading: 'New', oldHeading: 'Parent' })).toBeUndefined();
  });

  it('should return undefined for a link without a subpath', () => {
    expect(rewriteHeadingLink({ link: reference('[[target]]', 'target'), newHeading: 'New', oldHeading: 'Parent' })).toBeUndefined();
  });

  it('should return undefined for an external link', () => {
    expect(rewriteHeadingLink({ link: reference('[x](https://example.com#Parent)', 'https://example.com#Parent'), newHeading: 'New', oldHeading: 'Parent' })).toBeUndefined();
  });

  it('should return undefined for a reference that is not a link', () => {
    expect(rewriteHeadingLink({ link: reference('plain text', 'plain text'), newHeading: 'New', oldHeading: 'Parent' })).toBeUndefined();
  });
});

describe('updateHeadingBacklinks', () => {
  let app: AppOriginal;
  let resourceLockComponent: ResourceLockComponent;

  beforeEach(() => {
    app = App.createConfigured__({
      files: {
        'note.md': [
          'Links: [[target#Parent#Child]] and [[target#Parent]] and [md](target.md#Parent#Child) and',
          'block [[target#^abc]] and plain [[target]] and unrelated [[other]].'
        ].join('\n'),
        'other.md': 'other body',
        'target.md': '# Parent\n\ntext\n\n## Child\n\ntext\n'
      }
    }).asOriginalType__();
    castTo<MetadataCacheWithCompute>(app.metadataCache).computeMetadataAsync = vi.fn();
    resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
    resourceLockComponent.load();

    // OTM's MetadataCache does not implement `getBacklinksForFile`, so discovery is driven from the
    // Real parsed link cache of the linking note (only its target-referencing links). The rewrite path
    // (editLinks + rewriteHeadingLink + the real files) stays real; `[[other]]` is intentionally left
    // Out so the converter's "reference not in the backlink set" branch is exercised.
    const noteFile = ensureNonNullable(app.vault.getFileByPath('note.md'));
    const targetLinks = (app.metadataCache.getFileCache(noteFile)?.links ?? []).filter((link) => link.link.startsWith('target'));
    const backlinks = castTo<Awaited<ReturnType<typeof getBacklinksForFileSafe>>>(new Map<string, Reference[]>([['note.md', targetLinks]]));
    vi.mocked(getBacklinksForFileSafe).mockResolvedValue(backlinks);
  });

  afterEach(() => {
    resourceLockComponent.unload();
    vi.restoreAllMocks();
  });

  function noticeStub(): PluginNoticeComponent {
    return strictProxy<PluginNoticeComponent>({ showNotice: vi.fn() });
  }

  it('should rewrite every link referencing the renamed heading, including nested ones', async () => {
    const updatedCount = await updateHeadingBacklinks({
      abortSignal: new AbortController().signal,
      app,
      newHeading: 'New',
      notePathOrFile: 'target.md',
      oldHeading: 'Parent',
      pluginNoticeComponent: noticeStub(),
      resourceLockComponent
    });

    const noteContent = await app.vault.read(ensureNonNullable(app.vault.getFileByPath('note.md')));
    expect(noteContent).toContain('[[target#New#Child]]');
    expect(noteContent).toContain('[[target#New]]');
    expect(noteContent).toContain('[md](target.md#New#Child)');
    // Block reference, plain link, and unrelated link are untouched.
    expect(noteContent).toContain('[[target#^abc]]');
    expect(noteContent).toContain('[[target]]');
    expect(noteContent).toContain('[[other]]');
    expect(updatedCount).toBe(3);
  });

  it('should return 0 when no backlink references the renamed heading', async () => {
    const updatedCount = await updateHeadingBacklinks({
      abortSignal: new AbortController().signal,
      app,
      newHeading: 'New',
      notePathOrFile: 'target.md',
      oldHeading: 'Nonexistent',
      pluginNoticeComponent: noticeStub(),
      resourceLockComponent
    });
    expect(updatedCount).toBe(0);
  });
});
