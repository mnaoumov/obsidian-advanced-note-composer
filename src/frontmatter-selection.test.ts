import {
  describe,
  expect,
  it
} from 'vitest';

import type { Selection } from './composers/composer-base.ts';

import { extractFrontmatterSelection } from './frontmatter-selection.ts';

interface ExtractionSummary {
  extractedYaml: string;
  remainingYaml: string;
}

const ALIASES_NOTE = [
  '---',
  'aliases:',
  '  - alpha',
  '  - bravo',
  '  - charlie',
  'tags:',
  '  - x',
  '---',
  '',
  'body',
  ''
].join('\n');

describe('extractFrontmatterSelection', () => {
  function extract(content: string, ...selections: Selection[]): ExtractionSummary | null {
    const result = extractFrontmatterSelection({ content, selections });
    if (!result) {
      return null;
    }
    return {
      extractedYaml: result.extractedYaml,
      remainingYaml: result.remainingYaml
    };
  }

  function selectText(content: string, from: string, to: string): Selection {
    return {
      endOffset: content.indexOf(to) + to.length,
      startOffset: content.indexOf(from)
    };
  }

  it('should reconstruct the property key over a selection of some of its values', () => {
    // The reporter's own gesture: the selection starts mid-value, so whole-line expansion is what makes it
    // Land on the two `aliases` items rather than on a fragment of YAML text.
    expect(extract(ALIASES_NOTE, selectText(ALIASES_NOTE, 'pha', 'bravo'))).toEqual({
      extractedYaml: 'aliases:\n  - alpha\n  - bravo',
      remainingYaml: 'aliases:\n  - charlie\ntags:\n  - x'
    });
  });

  it('should keep the key line out of the remainder when the whole property is selected', () => {
    const content = ['---', 'aliases:', '  - alpha', '  - bravo', 'tags:', '  - x', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, 'aliases:', '  - bravo'))).toEqual({
      extractedYaml: 'aliases:\n  - alpha\n  - bravo',
      remainingYaml: 'tags:\n  - x'
    });
  });

  it('should drop a key line left with no values of its own', () => {
    expect(extract(ALIASES_NOTE, selectText(ALIASES_NOTE, '  - alpha', 'charlie'))).toEqual({
      extractedYaml: 'aliases:\n  - alpha\n  - bravo\n  - charlie',
      remainingYaml: 'tags:\n  - x'
    });
  });

  it('should take a scalar property in full when only part of its value is selected', () => {
    const content = ['---', 'title: My Note', 'tags:', '  - x', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, 'My', 'My'))).toEqual({
      extractedYaml: 'title: My Note',
      remainingYaml: 'tags:\n  - x'
    });
  });

  it('should pull the whole ancestor chain of a nested value', () => {
    const content = ['---', 'meta:', '  author:', '    name: Bob', '    age: 42', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '    name: Bob', '    name: Bob'))).toEqual({
      extractedYaml: 'meta:\n  author:\n    name: Bob',
      remainingYaml: 'meta:\n  author:\n    age: 42'
    });
  });

  it('should collapse emptied nested maps upwards', () => {
    const content = ['---', 'meta:', '  author:', '    name: Bob', 'tags:', '  - x', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '    name: Bob', '    name: Bob'))).toEqual({
      extractedYaml: 'meta:\n  author:\n    name: Bob',
      remainingYaml: 'tags:\n  - x'
    });
  });

  it('should recognize unindented sequence items as values of the key above them', () => {
    const content = ['---', 'aliases:', '- alpha', '- bravo', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '- alpha', '- alpha'))).toEqual({
      extractedYaml: 'aliases:\n- alpha',
      remainingYaml: 'aliases:\n- bravo'
    });
  });

  it('should look past a comment line when resolving the property a value belongs to', () => {
    const content = ['---', 'aliases:', '  # the good ones', '  - alpha', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '  - alpha', '  - alpha'))).toEqual({
      extractedYaml: 'aliases:\n  - alpha',
      remainingYaml: '  # the good ones'
    });
  });

  it('should look past a blank line when resolving the property a value belongs to', () => {
    const content = ['---', 'aliases:', '', '  - alpha', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '  - alpha', '  - alpha'))).toEqual({
      extractedYaml: 'aliases:\n  - alpha',
      remainingYaml: ''
    });
  });

  it('should keep an empty property that had no values to begin with', () => {
    const content = ['---', 'aliases:', 'title: My Note', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, 'title: My Note', 'title: My Note'))).toEqual({
      extractedYaml: 'title: My Note',
      remainingYaml: 'aliases:'
    });
  });

  it('should keep comments and key order in the remainder', () => {
    const content = ['---', '# who wrote this', 'author: Bob', 'aliases:', '  - alpha', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '  - alpha', '  - alpha'))).toEqual({
      extractedYaml: 'aliases:\n  - alpha',
      remainingYaml: '# who wrote this\nauthor: Bob'
    });
  });

  it('should honor several selections at once', () => {
    const content = ['---', 'title: My Note', 'aliases:', '  - alpha', '  - bravo', '---', '', 'body', ''].join('\n');
    expect(
      extract(
        content,
        selectText(content, 'title: My Note', 'title: My Note'),
        selectText(content, '  - bravo', '  - bravo')
      )
    ).toEqual({
      extractedYaml: 'title: My Note\naliases:\n  - bravo',
      remainingYaml: 'aliases:\n  - alpha'
    });
  });

  it('should report the frontmatter region the remainder replaces', () => {
    const result = extractFrontmatterSelection({
      content: ALIASES_NOTE,
      selections: [selectText(ALIASES_NOTE, '  - alpha', '  - alpha')]
    });
    expect(result?.frontmatterStartOffset).toBe(ALIASES_NOTE.indexOf('aliases:'));
    expect(result?.frontmatterEndOffset).toBe(ALIASES_NOTE.indexOf('\n---\n\nbody'));
  });

  it('should ignore a note without frontmatter', () => {
    const content = 'aliases:\n  - alpha\n';
    expect(extract(content, selectText(content, '  - alpha', '  - alpha'))).toBeNull();
  });

  it('should ignore a selection outside the frontmatter block', () => {
    expect(extract(ALIASES_NOTE, selectText(ALIASES_NOTE, 'body', 'body'))).toBeNull();
  });

  it('should ignore a selection that spans out of the frontmatter block', () => {
    expect(extract(ALIASES_NOTE, selectText(ALIASES_NOTE, '  - charlie', 'body'))).toBeNull();
  });

  it('should ignore a selection that selects nothing', () => {
    const caretOffset = ALIASES_NOTE.indexOf('  - alpha');
    expect(extract(ALIASES_NOTE, { endOffset: caretOffset, startOffset: caretOffset })).toBeNull();
  });

  it('should ignore a selection covering only blank lines', () => {
    const content = ['---', 'title: My Note', '', '', 'tags:', '  - x', '---', '', 'body', ''].join('\n');
    const blankStart = content.indexOf('My Note') + 'My Note'.length + 1;
    expect(extract(content, { endOffset: blankStart + 1, startOffset: blankStart })).toBeNull();
  });

  it('should ignore a selection whose lines are not a YAML map', () => {
    // The `- alpha` line has no key line to belong to — the one above it carries a value of its own — so it
    // Stays an orphaned sequence item, which is not a set of properties.
    const content = ['---', 'title: My Note', '- alpha', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '- alpha', '- alpha'))).toBeNull();
  });

  it('should ignore a selection whose lines are not YAML at all', () => {
    const content = ['---', 'just text', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, 'just text', 'just text'))).toBeNull();
  });

  it('should ignore a selection whose lines do not parse as YAML', () => {
    const content = ['---', 'aliases: [alpha', 'title: My Note', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, 'aliases: [alpha', 'aliases: [alpha'))).toBeNull();
  });

  it('should ignore a selection of a comment alone', () => {
    const content = ['---', '# who wrote this', 'author: Bob', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '# who wrote this', '# who wrote this'))).toBeNull();
  });

  it('should ignore a selection that yields no properties', () => {
    const content = ['---', '{}', '---', '', 'body', ''].join('\n');
    expect(extract(content, selectText(content, '{}', '{}'))).toBeNull();
  });
});
