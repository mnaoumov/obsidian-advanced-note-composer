import {
  describe,
  expect,
  it
} from 'vitest';

import {
  areRegionsOverlapping,
  swapContents,
  swapSameFileContent
} from './swap-selections.ts';

describe('swap-selections', () => {
  describe('swapContents', () => {
    it('should exchange the two regions across notes, handling different lengths', () => {
      const result = swapContents({
        sourceContent: 'AAA [source] BBB',
        sourceRegion: { endOffset: 12, startOffset: 4 },
        targetContent: 'xx [the target selection] yy',
        targetRegion: { endOffset: 25, startOffset: 3 }
      });

      expect(result.newSourceContent).toBe('AAA [the target selection] BBB');
      expect(result.newTargetContent).toBe('xx [source] yy');
    });

    it('should support empty regions (plain insert of the other side)', () => {
      const result = swapContents({
        sourceContent: 'keep',
        sourceRegion: { endOffset: 4, startOffset: 0 },
        targetContent: 'a  b',
        targetRegion: { endOffset: 2, startOffset: 2 }
      });

      expect(result.newSourceContent).toBe('');
      expect(result.newTargetContent).toBe('a keep b');
    });
  });

  describe('swapSameFileContent', () => {
    it('should exchange two regions in one note when regionA precedes regionB', () => {
      // "one" at [0,3), "three" at [8,13)
      const content = 'one and three';
      const result = swapSameFileContent({
        content,
        regionA: { endOffset: 3, startOffset: 0 },
        regionB: { endOffset: 13, startOffset: 8 }
      });

      expect(result).toBe('three and one');
    });

    it('should exchange two regions in one note when regionB precedes regionA (unsorted input)', () => {
      const content = 'one and three';
      const result = swapSameFileContent({
        content,
        regionA: { endOffset: 13, startOffset: 8 },
        regionB: { endOffset: 3, startOffset: 0 }
      });

      expect(result).toBe('three and one');
    });
  });

  describe('areRegionsOverlapping', () => {
    it('should return true when the regions share characters', () => {
      expect(areRegionsOverlapping({ endOffset: 5, startOffset: 0 }, { endOffset: 8, startOffset: 3 })).toBe(true);
    });

    it('should return false for disjoint or merely adjacent regions', () => {
      expect(areRegionsOverlapping({ endOffset: 3, startOffset: 0 }, { endOffset: 8, startOffset: 5 })).toBe(false);
      expect(areRegionsOverlapping({ endOffset: 3, startOffset: 0 }, { endOffset: 6, startOffset: 3 })).toBe(false);
    });
  });
});
