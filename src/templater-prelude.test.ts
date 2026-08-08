import {
  describe,
  expect,
  it
} from 'vitest';

import type { CreateFolderTemplateTokens } from './template-tokens.ts';

import {
  buildTemplaterPrelude,
  insertTemplaterPrelude
} from './templater-prelude.ts';

const TOKENS: CreateFolderTemplateTokens = {
  folderName: '1. Test Notes',
  folderPath: 'Inbox/1. Test Notes',
  index: 1,
  parentFolder: 'Inbox',
  parentFolderPath: 'Inbox',
  rawFolderName: 'test notes',
  safeFolderName: 'Test Notes'
};

describe('buildTemplaterPrelude', () => {
  it('should declare every token in one execution command', () => {
    expect(buildTemplaterPrelude(TOKENS)).toBe([
      '<%*',
      'const TOKENS = {',
      '  folderName: "1. Test Notes",',
      '  folderPath: "Inbox/1. Test Notes",',
      '  index: 1,',
      '  parentFolder: "Inbox",',
      '  parentFolderPath: "Inbox",',
      '  rawFolderName: "test notes",',
      '  safeFolderName: "Test Notes"',
      '};',
      '-%>',
      ''
    ].join('\n'));
  });

  it('should keep the index a number, so it can be used in arithmetic', () => {
    // `<% TOKENS.index + 1 %>` has to add, not concatenate — the whole reason the values are injected as
    // Source rather than substituted as text.
    expect(buildTemplaterPrelude(TOKENS)).toContain('index: 1,');
  });

  it('should escape a double quote in a value', () => {
    const prelude = buildTemplaterPrelude({ ...TOKENS, safeFolderName: 'Say "Hi"' });
    expect(prelude).toContain(String.raw`safeFolderName: "Say \"Hi\""`);
  });

  it('should escape a newline in a value', () => {
    const prelude = buildTemplaterPrelude({ ...TOKENS, rawFolderName: 'a\nb' });
    expect(prelude).toContain(String.raw`rawFolderName: "a\nb"`);
  });

  it('should escape a backslash in a value', () => {
    const prelude = buildTemplaterPrelude({ ...TOKENS, rawFolderName: String.raw`a\b` });
    expect(prelude).toContain(String.raw`rawFolderName: "a\\b"`);
  });

  it('should close with -%>, which trims the newline after it', () => {
    expect(buildTemplaterPrelude(TOKENS)).toContain('\n-%>\n');
  });
});

describe('insertTemplaterPrelude', () => {
  it('should prepend the prelude to content without frontmatter', () => {
    const result = insertTemplaterPrelude({ content: '# Heading\n', tokens: TOKENS });
    expect(result).toBe(`${buildTemplaterPrelude(TOKENS)}# Heading\n`);
  });

  it('should insert the prelude BELOW a frontmatter block', () => {
    // Above the opening `---` the block would stop being frontmatter at all, so `tp.frontmatter` — and
    // Obsidian's own metadata cache — would see nothing.
    const content = '---\ntitle: X\n---\n# Heading\n';
    const result = insertTemplaterPrelude({ content, tokens: TOKENS });
    expect(result).toBe(`---\ntitle: X\n---\n${buildTemplaterPrelude(TOKENS)}# Heading\n`);
  });

  it('should handle empty content', () => {
    expect(insertTemplaterPrelude({ content: '', tokens: TOKENS })).toBe(buildTemplaterPrelude(TOKENS));
  });
});
