import {
  describe,
  expect,
  it
} from 'vitest';

import { compareNatural } from './natural-sort.ts';

describe('compareNatural', () => {
  it('should order the numbers a name is built from numerically, not as text', () => {
    // Issue #208: with 50 numbered folders the reporter saw `5.` land after `30.`, because `'30.' < '5.'`
    // As text.
    expect(['30. Thirty', '5. Five', '10. Ten', '2. Two'].sort(compareNatural)).toStrictEqual([
      '2. Two',
      '5. Five',
      '10. Ten',
      '30. Thirty'
    ]);
  });

  it('should compare every numeric run in the name, not only the leading one', () => {
    // The owner's spec for the generalized rule.
    expect(['1111alpha45678', '234alpha567', '1111alpha567'].sort(compareNatural)).toStrictEqual([
      '234alpha567',
      '1111alpha567',
      '1111alpha45678'
    ]);
  });

  it('should keep a dotted index sequence in hierarchy order', () => {
    expect(['2. Two', '1.1.1 Deep', '1. One', '1.1 Sub'].sort(compareNatural)).toStrictEqual([
      '1. One',
      '1.1 Sub',
      '1.1.1 Deep',
      '2. Two'
    ]);
  });

  it('should order names with no numbers in them alphabetically', () => {
    expect(['zeta.md', 'alpha.md', 'beta.md'].sort(compareNatural)).toStrictEqual([
      'alpha.md',
      'beta.md',
      'zeta.md'
    ]);
  });

  it('should report equal names as equal', () => {
    expect(compareNatural('1. One', '1. One')).toBe(0);
  });
});
