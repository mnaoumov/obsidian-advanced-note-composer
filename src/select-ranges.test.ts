import type { HeadingInfo } from '@obsidian-typings/obsidian-public-latest/implementations';
import type {
  App,
  Editor,
  TFile
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from './composers/composer-base.ts';
import {
  getHeadingContentSelection,
  normalizeSelectionRange,
  resolveEnclosingHeadingInfo
} from './select-ranges.ts';

vi.mock('./composers/composer-base.ts', () => ({
  getEnclosingHeadingLine: vi.fn(),
  getSelectionUnderHeading: vi.fn()
}));

const mockGetEnclosingHeadingLine = vi.mocked(getEnclosingHeadingLine);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);

function createEditor(range = ''): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 4, line: 7 }),
    getRange: vi.fn().mockReturnValue(range)
  });
}

function headingInfo(startLine: number, endLine: number, endCh = 10): HeadingInfo {
  return {
    end: { ch: endCh, line: endLine },
    heading: 'Heading',
    start: { ch: 0, line: startLine }
  };
}

describe('getHeadingContentSelection', () => {
  it('starts on the line below the heading and keeps the section end', () => {
    expect(getHeadingContentSelection({ editor: createEditor('body text'), headingInfo: headingInfo(3, 9) })).toEqual({
      end: { ch: 10, line: 9 },
      start: { ch: 0, line: 4 }
    });
  });

  // A heading immediately followed by another one collapses to a single line, because
  // `getSelectionUnderHeading` walks its end back over the blank lines between the two.
  it('returns null for a heading whose section is one line', () => {
    expect(getHeadingContentSelection({ editor: createEditor('body text'), headingInfo: headingInfo(3, 3) })).toBeNull();
  });

  // The LAST heading of a note is reported differently: its end stays at the document's final line even
  // When everything below it is blank, so the line count alone cannot answer this one.
  it('returns null when the section below the heading is only blank lines', () => {
    expect(getHeadingContentSelection({ editor: createEditor('  \n\n  '), headingInfo: headingInfo(3, 9) })).toBeNull();
  });
});

describe('normalizeSelectionRange', () => {
  it('keeps an anchor that precedes the cursor', () => {
    expect(normalizeSelectionRange(4, 11)).toEqual({ fromOffset: 4, toOffset: 11 });
  });

  // Anchoring and then moving the caret BACKWARDS is ordinary, not an edge case — on a phone the caret is
  // Placed by tapping, and taps do not arrive in document order.
  it('swaps an anchor that follows the cursor', () => {
    expect(normalizeSelectionRange(11, 4)).toEqual({ fromOffset: 4, toOffset: 11 });
  });

  it('yields an empty range when the anchor and the cursor coincide', () => {
    expect(normalizeSelectionRange(7, 7)).toEqual({ fromOffset: 7, toOffset: 7 });
  });
});

describe('resolveEnclosingHeadingInfo', () => {
  const app = strictProxy<App>({});
  const file = strictProxy<TFile>({ path: 'note.md' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the cursor is under no heading', () => {
    mockGetEnclosingHeadingLine.mockReturnValue(null);
    expect(resolveEnclosingHeadingInfo({ app, editor: createEditor(), file })).toBeNull();
    expect(mockGetSelectionUnderHeading).not.toHaveBeenCalled();
  });

  it('resolves the enclosing heading from the cursor line', () => {
    const info = headingInfo(3, 9);
    mockGetEnclosingHeadingLine.mockReturnValue(3);
    mockGetSelectionUnderHeading.mockReturnValue(info);

    expect(resolveEnclosingHeadingInfo({ app, editor: createEditor(), file })).toBe(info);
    expect(mockGetEnclosingHeadingLine).toHaveBeenCalledWith({ app, cursorLine: 7, file });
    expect(mockGetSelectionUnderHeading).toHaveBeenCalledWith(expect.objectContaining({ lineNumber: 3 }));
  });

  // Line 0 is falsy — the lookup must test for `null`, not for truthiness, or a heading on the note's
  // First line would report as "no heading" and both heading select commands would vanish there.
  it('resolves a heading on the very first line', () => {
    const info = headingInfo(0, 5);
    mockGetEnclosingHeadingLine.mockReturnValue(0);
    mockGetSelectionUnderHeading.mockReturnValue(info);

    expect(resolveEnclosingHeadingInfo({ app, editor: createEditor(), file })).toBe(info);
  });
});
