import type { PrismModule } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import { TOKENIZED_STRING_LANGUAGE } from './tokenized-string-language.ts';

describe('tokenized-string template language', () => {
  it('highlights the {{token:format}} placeholders of a template through real Prism', async () => {
    const result = await evalInObsidian({
      async callback({ language, lib: { waitUntil }, obsidianModule }) {
        // `obsidian`'s own `loadPrism()` is typed as returning `unknown`.
        const prism = await obsidianModule.loadPrism() as PrismModule;

        await waitUntil({
          message: `Prism language "${language}" was not registered`,
          predicate: () => prism.languages[language] !== undefined
        });

        const grammar = prism.languages[language];
        if (!grammar) {
          throw new Error(`Prism language "${language}" is missing.`);
        }

        return { html: prism.highlight('{{title:YYYY-MM-DD}}', grammar, language) };
      },
      input: { language: TOKENIZED_STRING_LANGUAGE }
    });

    // The settings tab's code-highlighter fields render exactly this markup, so this asserts what the
    // user sees: each part of `{{title:YYYY-MM-DD}}` carries its own token class.
    expect(result.html).toContain('class="token prefix regex"');
    expect(result.html).toContain('class="token token number"');
    expect(result.html).toContain('class="token formatDelimiter regex"');
    expect(result.html).toContain('class="token format string"');
    expect(result.html).toContain('class="token suffix regex"');
    expect(result.html).toContain('YYYY-MM-DD');
  });
});
