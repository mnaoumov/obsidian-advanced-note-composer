import type { HeadingCache } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { SplitReorderableSectionsResult } from './heading-sections.ts';

import {
  computeHeadingTexts,
  isEveryHeadingNumbered,
  stripHeadingNumber
} from './heading-numbering.ts';
import { splitIntoReorderableSections } from './heading-sections.ts';

const INDEX_TEMPLATE = '{{index}}. {{headingText}}';
const OUTLINE_TEMPLATE = '{{outlineIndex}} {{headingText}}';

function parseHeadings(content: string): HeadingCache[] {
  const headings: HeadingCache[] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    const match = /^(?<Hashes>#+)\s+(?<Text>.*)$/.exec(line);
    const hashes = match?.groups?.['Hashes'];
    const text = match?.groups?.['Text'];
    if (hashes !== undefined && text !== undefined) {
      headings.push(castTo<HeadingCache>({
        heading: text,
        level: hashes.length,
        position: { start: { offset } }
      }));
    }
    offset += line.length + 1;
  }
  return headings;
}

function split(content: string): SplitReorderableSectionsResult {
  return splitIntoReorderableSections(content, parseHeadings(content));
}

describe('computeHeadingTexts', () => {
  it('should number every heading by its position among its siblings', () => {
    const note = split('# A\n## A1\n## A2\n# B\n## B1\n');
    expect(computeHeadingTexts(note, { shouldNumber: true, template: INDEX_TEMPLATE, wasNumbered: false }))
      .toEqual(['1. A', '1. A1', '2. A2', '2. B', '1. B1']);
  });

  it('should number by the outline chain', () => {
    const note = split('# A\n## A1\n### A1a\n## A2\n# B\n');
    expect(computeHeadingTexts(note, { shouldNumber: true, template: OUTLINE_TEMPLATE, wasNumbered: false }))
      .toEqual(['1 A', '1.1 A1', '1.1.1 A1a', '1.2 A2', '2 B']);
  });

  it('should replace an existing number rather than add a second one', () => {
    const note = split('# 2. B\n# 1. A\n');
    expect(computeHeadingTexts(note, { shouldNumber: true, template: INDEX_TEMPLATE, wasNumbered: true }))
      .toEqual(['1. B', '2. A']);
  });

  it('should follow the tree as it stands, not the document order', () => {
    const note = split('# A\n# B\n');
    note.roots.reverse();
    expect(computeHeadingTexts(note, { shouldNumber: true, template: INDEX_TEMPLATE, wasNumbered: false }))
      .toEqual(['2. A', '1. B']);
  });

  it('should strip the numbers of a numbered note when numbering is turned off', () => {
    const note = split('# 1. A\n## 1. A1\n');
    expect(computeHeadingTexts(note, { shouldNumber: false, template: INDEX_TEMPLATE, wasNumbered: true }))
      .toEqual(['A', 'A1']);
  });

  it('should leave the headings of a note that was not numbered exactly as typed', () => {
    const note = split('# 1. Intro\n# Background\n');
    expect(computeHeadingTexts(note, { shouldNumber: false, template: INDEX_TEMPLATE, wasNumbered: false }))
      .toEqual(['1. Intro', 'Background']);
  });
});

describe('isEveryHeadingNumbered', () => {
  it('should be true when every heading carries a number the template could have written', () => {
    expect(isEveryHeadingNumbered(split('# 1. A\n## 1. A1\n'), INDEX_TEMPLATE)).toBe(true);
  });

  it('should be false when one heading carries none', () => {
    expect(isEveryHeadingNumbered(split('# 1. A\n## A1\n'), INDEX_TEMPLATE)).toBe(false);
  });

  it('should be false for a note with no headings', () => {
    expect(isEveryHeadingNumbered(split('text\n'), INDEX_TEMPLATE)).toBe(false);
  });

  it('should be false when the template writes no number', () => {
    expect(isEveryHeadingNumbered(split('# A\n'), '{{headingText}}')).toBe(false);
  });
});

describe('stripHeadingNumber', () => {
  it('should remove a per-sibling number', () => {
    expect(stripHeadingNumber({ headingText: '12. Plans', template: INDEX_TEMPLATE })).toBe('Plans');
  });

  it('should remove an outline number of any depth', () => {
    expect(stripHeadingNumber({ headingText: '1.2.3 Plans', template: OUTLINE_TEMPLATE })).toBe('Plans');
  });

  it('should read a number written after the text', () => {
    expect(stripHeadingNumber({ headingText: 'Plans (3)', template: '{{headingText}} ({{index}})' })).toBe('Plans');
  });

  it('should widen every other token', () => {
    expect(stripHeadingNumber({ headingText: '2026-09-25 1. Plans', template: '{{date}} {{index}}. {{headingText}}' })).toBe('Plans');
  });

  it('should capture only the first heading-text token', () => {
    expect(stripHeadingNumber({ headingText: '1. Plans / Plans', template: '{{index}}. {{headingText}} / {{headingText}}' })).toBe('Plans');
  });

  it('should leave a heading the template could not have written unchanged', () => {
    expect(stripHeadingNumber({ headingText: 'Plans', template: INDEX_TEMPLATE })).toBe('Plans');
  });

  it('should leave the heading unchanged when the template has no heading-text token', () => {
    expect(stripHeadingNumber({ headingText: '1. Plans', template: '{{index}}. Heading' })).toBe('1. Plans');
  });
});
