import {
  describe,
  expect,
  it
} from 'vitest';

import type { CreateFolderTemplateTokens } from './template-tokens.ts';

import { buildTemplaterPrelude } from './templater-prelude.ts';

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
      `const TOKENS = ${
        JSON.stringify({
          folderName: '1. Test Notes',
          folderPath: 'Inbox/1. Test Notes',
          index: 1,
          parentFolder: 'Inbox',
          parentFolderPath: 'Inbox',
          rawFolderName: 'test notes',
          safeFolderName: 'Test Notes'
        })
      };`,
      '-%>',
      ''
    ].join('\n'));
  });

  it('should keep the index a number, so it can be used in arithmetic', () => {
    // `<% TOKENS.index + 1 %>` has to add, not concatenate — the whole reason the values are injected as
    // Source rather than substituted as text.
    expect(buildTemplaterPrelude(TOKENS)).toContain('"index":1');
  });

  it('should escape a double quote in a value', () => {
    const prelude = buildTemplaterPrelude({ ...TOKENS, safeFolderName: 'Say "Hi"' });
    expect(prelude).toContain(String.raw`"safeFolderName":"Say \"Hi\""`);
  });

  it('should escape a newline in a value', () => {
    const prelude = buildTemplaterPrelude({ ...TOKENS, rawFolderName: 'a\nb' });
    expect(prelude).toContain(String.raw`"rawFolderName":"a\nb"`);
  });

  it('should escape a backslash in a value', () => {
    const prelude = buildTemplaterPrelude({ ...TOKENS, rawFolderName: String.raw`a\b` });
    expect(prelude).toContain(String.raw`"rawFolderName":"a\\b"`);
  });

  it('should close with -%>, which trims the newline after it', () => {
    expect(buildTemplaterPrelude(TOKENS)).toContain('\n-%>\n');
  });

  it('should declare TOKENS before anything a template could reference it from', () => {
    // The whole placement contract in one assertion: callers prepend this, so the `const` can never sit in
    // The temporal dead zone of a command above it — which is what made `aliases: <% TOKENS.… %>` in a
    // Note's own frontmatter abandon the entire note.
    expect(buildTemplaterPrelude(TOKENS).startsWith('<%*\nconst TOKENS = {')).toBe(true);
  });
});
