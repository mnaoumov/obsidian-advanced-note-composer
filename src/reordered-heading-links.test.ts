import type {
  App as AppOriginal,
  CachedMetadata,
  HeadingCache,
  Reference
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { resolveSubpath } from 'obsidian';
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

import type { SplitReorderableSectionsResult } from './heading-sections.ts';
import type { ResolveReorderedHeadingSubpathParams } from './reordered-heading-links.ts';

import {
  resolveReorderedHeadingSubpath,
  updateReorderedHeadingLinks
} from './reordered-heading-links.ts';

interface MetadataCacheWithCompute {
  computeMetadataAsync: () => void;
}

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  resolveSubpath: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>()),
  getBacklinksForFileSafe: vi.fn()
}));

function resolveParams(overrides: Partial<ResolveReorderedHeadingSubpathParams>): ResolveReorderedHeadingSubpathParams {
  return {
    newHeadingPaths: [['A'], ['B'], ['B', 'A1']],
    oldHeadingPaths: [['A'], ['A', 'A1'], ['B']],
    resolveNewHeadingIndex: (subpath) => ({ '#A1': 2, '#B': 1, '#B#A1': 2 } as Record<string, number | undefined>)[subpath] ?? null,
    resolveOldHeadingIndex: (subpath) => ({ '#A#A1': 1, '#A1': 1, '#B': 2 } as Record<string, number | undefined>)[subpath] ?? null,
    subpath: '#A#A1',
    toNewHeadingIndex: (oldHeadingIndex) => [0, 2, 1][oldHeadingIndex] ?? null,
    ...overrides
  };
}

describe('resolveReorderedHeadingSubpath', () => {
  it('should rewrite a nested path whose heading moved under another parent', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({}))).toBe('#B#A1');
  });

  it('should rewrite a nested path that still resolves but no longer names the heading\'s ancestors', () => {
    // Obsidian matches `#A#A1` segment by segment in document order, so it still reaches `A1` under `B`.
    expect(resolveReorderedHeadingSubpath(resolveParams({
      resolveNewHeadingIndex: (subpath) => ['#A#A1', '#B#A1'].includes(subpath) ? 2 : null
    }))).toBe('#B#A1');
  });

  it('should leave a nested path that did not name the heading\'s ancestors to begin with', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({
      resolveNewHeadingIndex: () => 2,
      resolveOldHeadingIndex: () => 1,
      subpath: '#Other#A1'
    }))).toBeNull();
    expect(resolveReorderedHeadingSubpath(resolveParams({
      resolveNewHeadingIndex: () => 2,
      resolveOldHeadingIndex: () => 1,
      subpath: '#A1#A1'
    }))).toBeNull();
    expect(resolveReorderedHeadingSubpath(resolveParams({
      oldHeadingPaths: [],
      resolveNewHeadingIndex: () => 2
    }))).toBeNull();
  });

  it('should keep a nested path that still names ancestors, skipping levels between them', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({
      newHeadingPaths: [['A'], ['B'], ['A', 'X', 'A1']],
      resolveNewHeadingIndex: () => 2
    }))).toBeNull();
  });

  it('should leave a link that still reaches the same heading', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({ subpath: '#B' }))).toBeNull();
    expect(resolveReorderedHeadingSubpath(resolveParams({ subpath: '#A1' }))).toBeNull();
  });

  it('should leave a link with no heading subpath, or with a block segment', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({ subpath: '' }))).toBeNull();
    expect(resolveReorderedHeadingSubpath(resolveParams({ subpath: '#A#^block' }))).toBeNull();
  });

  it('should leave a link that resolved to nothing before the reorder', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({ subpath: '#Missing' }))).toBeNull();
    expect(resolveReorderedHeadingSubpath(resolveParams({ toNewHeadingIndex: () => null }))).toBeNull();
  });

  it('should try a longer path when the link\'s own length is ambiguous', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({
      newHeadingPaths: [['A'], ['B'], ['B', 'C', 'A1']],
      resolveNewHeadingIndex: (subpath) => subpath === '#B#C#A1' ? 2 : null
    }))).toBe('#B#C#A1');
  });

  it('should fall back to a shorter path when no path of the link\'s length reaches the heading', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({
      newHeadingPaths: [['A'], ['B'], ['B', 'A1']],
      resolveNewHeadingIndex: (subpath) => subpath === '#A1' ? 2 : null,
      resolveOldHeadingIndex: () => 1,
      subpath: '#X#Y#A1'
    }))).toBe('#A1');
  });

  it('should sanitize heading text written into the path', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({
      newHeadingPaths: [['A'], ['B'], ['B: b', 'A1']],
      resolveNewHeadingIndex: (subpath) => subpath === '#B b#A1' ? 2 : null
    }))).toBe('#B b#A1');
  });

  it('should give up when no path reaches the heading', () => {
    expect(resolveReorderedHeadingSubpath(resolveParams({ resolveNewHeadingIndex: () => null }))).toBeNull();
    expect(resolveReorderedHeadingSubpath(resolveParams({ newHeadingPaths: [], resolveNewHeadingIndex: () => null }))).toBeNull();
  });
});

describe('updateReorderedHeadingLinks', () => {
  const OLD_CACHE = castTo<CachedMetadata>({ headings: [heading('A', 1, 0), heading('A1', 2, 10), heading('B', 1, 20)] });
  const NEW_CACHE = castTo<CachedMetadata>({ headings: [heading('A', 1, 0), heading('B', 1, 10), heading('A1', 2, 20)] });
  // `#A#A1` still resolves after the move, as it does in Obsidian itself: it is rewritten because it no
  // longer names `A1`'s ancestors, not because it broke.
  const RESOLUTIONS = new Map<CachedMetadata, Record<string, number | undefined>>([
    [NEW_CACHE, { '#A#A1': 20, '#A1': 20, '#B': 10, '#B#A1': 20 }],
    [OLD_CACHE, { '#A#A1': 10, '#B': 20, '#Top': 0 }]
  ]);
  const SPLIT = castTo<SplitReorderableSectionsResult>({
    roots: [{ children: [], index: 0 }, { children: [{ children: [], index: 1 }], index: 2 }],
    sections: [{ headingText: 'A' }, { headingText: 'A1' }, { headingText: 'B' }]
  });

  let app: AppOriginal;
  let resourceLockComponent: ResourceLockComponent;

  function heading(text: string, level: number, offset: number): HeadingCache {
    return castTo<HeadingCache>({ heading: text, level, position: { start: { offset } } });
  }

  beforeEach(() => {
    app = App.createConfigured__({
      files: {
        'note.md': 'See [[target#A#A1]], [[target#B]], [[target#Top]], [[target#^blk]] and [[target]].',
        'target.md': '# A\n\n# B\n\n## A1\n'
      }
    }).asOriginalType__();
    castTo<MetadataCacheWithCompute>(app.metadataCache).computeMetadataAsync = vi.fn();
    resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
    resourceLockComponent.load();

    const noteFile = ensureNonNullable(app.vault.getFileByPath('note.md'));
    const links = app.metadataCache.getFileCache(noteFile)?.links ?? [];
    vi.mocked(getBacklinksForFileSafe).mockResolvedValue(castTo<Awaited<ReturnType<typeof getBacklinksForFileSafe>>>(
      new Map<string, Reference[]>([['note.md', links]])
    ));
    // `#Top` covers the two ways a resolution can fail to name a heading of the cache: before the reorder it
    // reports a heading at an offset no heading has, after it a block.
    vi.mocked(resolveSubpath).mockImplementation((cache, subpath) => {
      const offset = RESOLUTIONS.get(cache)?.[subpath];
      if (offset === undefined) {
        return castTo<ReturnType<typeof resolveSubpath>>(subpath === '#Top' ? { type: 'block' } : null);
      }
      return castTo<ReturnType<typeof resolveSubpath>>({ current: heading('', 1, offset === 0 ? -1 : offset), type: 'heading' });
    });
  });

  afterEach(() => {
    resourceLockComponent.unload();
    vi.restoreAllMocks();
  });

  function noticeStub(): PluginNoticeComponent {
    return strictProxy<PluginNoticeComponent>({ showNotice: vi.fn() });
  }

  it('should rewrite only the links the reorder broke, keeping each link\'s style', async () => {
    const count = await updateReorderedHeadingLinks({
      abortSignal: new AbortController().signal,
      app,
      newCache: NEW_CACHE,
      oldCache: OLD_CACHE,
      order: [0, 2, 1],
      path: 'target.md',
      pluginNoticeComponent: noticeStub(),
      resourceLockComponent,
      split: SPLIT
    });

    expect(count).toBe(1);
    expect(await app.vault.read(ensureNonNullable(app.vault.getFileByPath('note.md'))))
      .toBe('See [[target#B#A1]], [[target#B]], [[target#Top]], [[target#^blk]] and [[target]].');
  });

  it('should touch nothing when the heading count changed, since the mapping would then be wrong', async () => {
    const count = await updateReorderedHeadingLinks({
      abortSignal: new AbortController().signal,
      app,
      newCache: castTo<CachedMetadata>({}),
      oldCache: OLD_CACHE,
      order: [0, 2, 1],
      path: 'target.md',
      pluginNoticeComponent: noticeStub(),
      resourceLockComponent,
      split: SPLIT
    });

    expect(count).toBe(0);
    expect(getBacklinksForFileSafe).not.toHaveBeenCalled();
  });

  it('should treat a note with no headings in either cache as nothing to rewrite', async () => {
    const count = await updateReorderedHeadingLinks({
      abortSignal: new AbortController().signal,
      app,
      newCache: castTo<CachedMetadata>({}),
      oldCache: castTo<CachedMetadata>({}),
      order: [],
      path: 'target.md',
      pluginNoticeComponent: noticeStub(),
      resourceLockComponent,
      split: castTo<SplitReorderableSectionsResult>({ roots: [], sections: [] })
    });

    expect(count).toBe(0);
  });
});
