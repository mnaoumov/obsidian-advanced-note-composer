import type {
  CachedMetadata,
  Pos
} from 'obsidian';

import { resolveSubpath } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { buildExtractedSubpathPredicate } from './extracted-link-targets.ts';

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  resolveSubpath: vi.fn()
}));

const mockResolveSubpath = vi.mocked(resolveSubpath);

const CACHE = castTo<CachedMetadata>({});
const RANGES = [{ endOffset: 50, startOffset: 20 }];

function position(startOffset: number, endOffset: number): Pos {
  return {
    end: { col: 0, line: 0, offset: endOffset },
    start: { col: 0, line: 0, offset: startOffset }
  };
}

describe('buildExtractedSubpathPredicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should follow a link to the whole note only when the whole note moves', () => {
    expect(buildExtractedSubpathPredicate({ cache: CACHE, isWholeNoteMoved: true, ranges: [] })('')).toBe(true);
    expect(buildExtractedSubpathPredicate({ cache: CACHE, isWholeNoteMoved: false, ranges: RANGES })('')).toBe(false);
    expect(mockResolveSubpath).not.toHaveBeenCalled();
  });

  it('should leave every subpath behind when the note has no cache', () => {
    expect(buildExtractedSubpathPredicate({ cache: null, isWholeNoteMoved: true, ranges: RANGES })('#A')).toBe(false);
  });

  it('should follow a heading whose whole position lies inside a range, resolved the way Obsidian resolves it', () => {
    const isExtracted = buildExtractedSubpathPredicate({ cache: CACHE, isWholeNoteMoved: false, ranges: RANGES });

    mockResolveSubpath.mockReturnValue(castTo<ReturnType<typeof resolveSubpath>>({ current: { position: position(20, 30) }, type: 'heading' }));
    expect(isExtracted('#A b')).toBe(true);
    expect(mockResolveSubpath).toHaveBeenCalledWith(CACHE, '#A b');

    // Straddling the range's end: the heading stays, so the link does too.
    mockResolveSubpath.mockReturnValue(castTo<ReturnType<typeof resolveSubpath>>({ current: { position: position(45, 55) }, type: 'heading' }));
    expect(isExtracted('#A b')).toBe(false);
  });

  it('should follow a block inside a range and leave one outside it', () => {
    const isExtracted = buildExtractedSubpathPredicate({ cache: CACHE, isWholeNoteMoved: false, ranges: RANGES });

    mockResolveSubpath.mockReturnValue(castTo<ReturnType<typeof resolveSubpath>>({ block: { position: position(25, 40) }, type: 'block' }));
    expect(isExtracted('#^blk')).toBe(true);

    mockResolveSubpath.mockReturnValue(castTo<ReturnType<typeof resolveSubpath>>({ block: { position: position(0, 10) }, type: 'block' }));
    expect(isExtracted('#^blk')).toBe(false);
  });

  it('should leave a footnote link and an unresolved subpath behind', () => {
    const isExtracted = buildExtractedSubpathPredicate({ cache: CACHE, isWholeNoteMoved: false, ranges: RANGES });

    mockResolveSubpath.mockReturnValue(castTo<ReturnType<typeof resolveSubpath>>({ footnote: {}, type: 'footnote' }));
    expect(isExtracted('#[^1]')).toBe(false);

    mockResolveSubpath.mockReturnValue(null);
    expect(isExtracted('#Missing')).toBe(false);
  });
});
