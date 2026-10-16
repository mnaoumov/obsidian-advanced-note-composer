import {
  describe,
  expect,
  it
} from 'vitest';

import { toEnumValue } from './enum-value.ts';
import { FrontmatterMergeStrategy } from './plugin-settings.ts';

describe('toEnumValue', () => {
  it('should return the member whose value matches', () => {
    expect(toEnumValue(FrontmatterMergeStrategy, FrontmatterMergeStrategy.KeepOriginalFrontmatter)).toBe(FrontmatterMergeStrategy.KeepOriginalFrontmatter);
  });

  it('should throw for a value no member has', () => {
    expect(() => toEnumValue(FrontmatterMergeStrategy, 'NotAStrategy')).toThrow('Invalid enum value: NotAStrategy');
  });
});
