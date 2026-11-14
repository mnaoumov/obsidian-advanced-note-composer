import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { findSettingItemInObsidian } from '../../settings/settings-tab-navigation.ts';

const PLUGIN_ID = 'advanced-note-composer';

interface ExtractParams {
  readonly sourceContent: string;
  readonly targetBasename: string;
}

/**
 * Runs `Extract this heading...` from the first line of a fresh note into a brand-new note, with the
 * heading-aware merge on, and returns the created note's content.
 *
 * @param params - The source content and the new note's name.
 * @returns The created note's content.
 */
async function extractFirstHeading(params: ExtractParams): Promise<string> {
  return evalInObsidian({
    async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId, sourceContent, targetBasename }) {
      /*
       * Five waits share this ceiling (15 s), plus four settings-tab round trips of about 1.2 s and one
       * picker settle: about 20 s declared, under the transport's ~30 s cap.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
      const RENDER_DELAY_IN_MILLISECONDS = 400;

      const isOriginalShouldAsk = await didSetToggle('Should ask before splitting', false);
      // The bug lives in the heading-aware merge, which is off by default; the reporter has it on.
      const isOriginalShouldMergeHeadings = await didSetToggle('Should merge headings', true);
      try {
        const sourceFile = await app.vault.create(`${targetBasename}-source.md`, sourceContent);
        const editor = await openAndGetEditor(sourceFile);
        await waitUntil({
          message: 'heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings?.length ?? 0) === 2,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // The reporter's step 1: the caret on the first line, which is the outer heading.
        editor.setCursor({ ch: 0, line: 0 });

        app.commands.executeCommandById(`${pluginId}:extract-this-heading`);
        await waitUntil({
          message: 'split picker did not open',
          predicate: () => document.querySelector('.prompt-input') instanceof HTMLInputElement,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const input = document.querySelector('.prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('No split picker input.');
        }
        input.value = targetBasename;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        await pressKey({ key: 'Enter', modifiers: ['Mod'] });

        const targetPath = `${targetBasename}.md`;
        await waitUntil({
          message: 'extracted note was not created',
          predicate: () => app.vault.getAbstractFileByPath(targetPath) !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        await waitUntil({
          message: 'extracted note was not written',
          predicate: async () => {
            const file = app.vault.getAbstractFileByPath(targetPath);
            if (!(file instanceof obsidianModule.TFile)) {
              return false;
            }
            const content = await app.vault.read(file);
            return content.includes('body');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const extractedFile = app.vault.getAbstractFileByPath(targetPath);
        return extractedFile instanceof obsidianModule.TFile ? await app.vault.read(extractedFile) : '';
      } finally {
        await didSetToggle('Should merge headings', isOriginalShouldMergeHeadings);
        await didSetToggle('Should ask before splitting', isOriginalShouldAsk);
      }

      async function didSetToggle(name: string, shouldEnable: boolean): Promise<boolean> {
        app.setting.open();
        app.setting.openTabById(pluginId);
        const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
        if (!tab) {
          throw new Error('Settings tab was not found.');
        }
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const item = await findSettingItem({ app, name, settingTab: tab });
        const toggle = item?.querySelector('.checkbox-container');
        if (!(toggle instanceof HTMLElement)) {
          throw new TypeError(`"${name}" toggle was not found.`);
        }
        const wasEnabled = toggle.classList.contains('is-enabled');
        if (wasEnabled !== shouldEnable) {
          toggle.click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
        app.setting.close();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        return wasEnabled;
      }

      async function openAndGetEditor(file: TFile): Promise<Editor> {
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: `editor for ${file.path} did not open`,
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }
    },
    input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID, ...params },
    vaultPath: getTemporaryVault().path
  });
}

describe('extract a heading whose sub-heading follows it directly (issue #311)', () => {
  it('keeps the sub-heading on its own line', async () => {
    const extractedContent = await extractFirstHeading({
      sourceContent: '## Outer\n### Inner\nbody\n',
      targetBasename: 'issue-311-adjacent'
    });

    expect(extractedContent).not.toContain('## Outer###');
    expect(extractedContent).toContain('## Outer\n### Inner\n');
  });

  it('keeps the blank line between the heading and its sub-heading', async () => {
    const extractedContent = await extractFirstHeading({
      sourceContent: '## Outer\n\n### Inner\nbody\n',
      targetBasename: 'issue-311-blank-line'
    });

    expect(extractedContent).toContain('## Outer\n\n### Inner\n');
  });
});
