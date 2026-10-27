import {
  describe,
  expect,
  it
} from 'vitest';

import { InsertMode } from './insert-mode.ts';

describe('InsertMode', () => {
  it('should have Append value', () => {
    expect(InsertMode.Append).toBe('append');
  });

  it('should have Prepend value', () => {
    expect(InsertMode.Prepend).toBe('prepend');
  });
});
