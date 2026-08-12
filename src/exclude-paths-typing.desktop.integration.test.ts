import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// Desktop-only: this drives the plugin settings tab, which is where the report came from (matching the
// Plugin's established integration convention; no Android emulator is wired for it). G99: it uses only
// The stable settings-tab DOM (`.setting-item` / `textarea`) and public APIs, with no dependence on
// Minified Obsidian internals or serialization formats, so verifying on public-latest is sufficient.
// Isolation: `npx vitest run --project integration-tests:desktop src/exclude-paths-typing.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

// The value from issue #155, typed by hand. Its prefixes `/^Inbox\/` and `/^Inbox\/[^\/` both start AND
// End with `/`, so they read as finished regular expression literals whose inner source does not parse.
const REPORTED_EXCLUDE_PATH = String.raw`/^Inbox\/[^\/]*$/`;
const INCOMPLETE_EXCLUDE_PATH = String.raw`/^Inbox\/`;

// Minimal shape of the plugin's settings component reached at runtime, used only to restore the original
// Exclude paths afterwards (the same walker `merge-folder-skips-ignored.desktop.integration.test.ts` uses).
interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExcludePathsSettings;
}

interface ExcludePathsSettings {
  excludePaths: string[];
}

interface SettingsCarrier {
  editAndSave(editor: (settings: ExcludePathsSettings) => void): Promise<void>;
  settings: ExcludePathsSettings;
}

interface TypingResult {
  readonly noticesWhileTyping: string[];
  readonly savedExcludePaths: string[];
  readonly validationMessageForCompleteValue: string;
  readonly validationMessageForIncompleteValue: string;
}

describe('typing a regular expression into Exclude paths (issue #155)', () => {
  it('shows no error notice, still saves the completed value, and reports an incomplete one', async () => {
    const result = await evalInObsidian({
      async callback({ app, completeValue, findSettingItem, incompleteValue, lib: { waitUntil }, pluginId }): Promise<TypingResult> {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const KEYSTROKE_DELAY_IN_MILLISECONDS = 60;
        const SETTLE_DELAY_IN_MILLISECONDS = 400;
        const SETTLE_TIMEOUT_IN_MILLISECONDS = 10_000;
        const dataPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;

        const settingsComponent = findSettingsComponent();
        const originalExcludePaths = [...settingsComponent.settings.excludePaths];

        try {
          const textAreaEl = await openExcludePathsTextArea();
          await setValue(textAreaEl, '');
          // Clearing the field makes the tab write the default value back into the component from a
          // Debounced handler. Let that land BEFORE typing, or it would clobber the first keystrokes.
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);

          // Type the reported value one character at a time. Each `input` event is what makes the
          // Settings tab call `setProperty`, which is the code path that used to throw mid-typing.
          const noticesWhileTyping: string[] = [];
          for (let length = 1; length <= completeValue.length; length++) {
            await setValue(textAreaEl, completeValue.slice(0, length));
            await sleep(KEYSTROKE_DELAY_IN_MILLISECONDS);
            noticesWhileTyping.push(...noticeTexts());
          }

          // The debounced save must actually reach disk: the bug also broke `saveToFile`, because the
          // Half-applied setter re-threw from the `cloneState` round trip. Reading the file back is the
          // Only observation that covers that second failure surface. Every wait from here on gives up
          // Instead of throwing (`waitOrGiveUp`) — what it waits for IS the thing under test, and a
          // Thrown timeout would abort the closure and hide the notices collected above.
          await waitOrGiveUp(async () => {
            const excludePaths = await readSavedExcludePaths();
            return excludePaths.includes(completeValue);
          });
          const savedExcludePaths = await readSavedExcludePaths();
          await waitOrGiveUp(() => textAreaEl.validationMessage === '');
          const validationMessageForCompleteValue = textAreaEl.validationMessage;

          // An entry left incomplete is now REPORTED. Without this the whole list would quietly fall back
          // To its default pattern (obsidian-dev-utils 88.4.0) and silently stop excluding anything.
          await setValue(textAreaEl, incompleteValue);
          await waitOrGiveUp(() => textAreaEl.validationMessage !== '');
          const validationMessageForIncompleteValue = textAreaEl.validationMessage;

          await setValue(textAreaEl, '');
          return {
            noticesWhileTyping,
            savedExcludePaths,
            validationMessageForCompleteValue,
            validationMessageForIncompleteValue
          };
        } finally {
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await settingsComponent.editAndSave((settings) => {
            settings.excludePaths = originalExcludePaths;
          });
        }

        async function waitOrGiveUp(predicate: () => boolean | Promise<boolean>): Promise<void> {
          try {
            await waitUntil({
              message: 'expected settings state never settled',
              predicate,
              timeoutInMilliseconds: SETTLE_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Deliberately swallowed — the caller reads the actual state and asserts on it.
          }
        }

        async function setValue(textAreaEl: HTMLTextAreaElement, value: string): Promise<void> {
          textAreaEl.value = value;
          textAreaEl.dispatchEvent(new Event('input'));
          await sleep(KEYSTROKE_DELAY_IN_MILLISECONDS);
        }

        // Notices render into `activeDocument`, which is NOT `document` once a detached window exists —
        // Query both so the check cannot pass merely by looking in the wrong place.
        function noticeTexts(): string[] {
          const texts: string[] = [];
          for (const doc of new Set([activeDocument, document])) {
            for (const el of doc.querySelectorAll('.notice')) {
              texts.push(el.textContent);
            }
          }
          return texts;
        }

        async function readSavedExcludePaths(): Promise<string[]> {
          if (!await app.vault.adapter.exists(dataPath)) {
            return [];
          }
          const saved = JSON.parse(await app.vault.adapter.read(dataPath)) as Partial<ExcludePathsSettings>;
          return saved.excludePaths ?? [];
        }

        async function openExcludePathsTextArea(): Promise<HTMLTextAreaElement> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItem = await findSettingItem({ app, name: 'Exclude paths', settingTab });
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new TypeError('"Exclude paths" text area was not found.');
          }
          return textAreaEl;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && Array.isArray(node.settings?.excludePaths);
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }
      },
      input: {
        completeValue: REPORTED_EXCLUDE_PATH,
        findSettingItem: findSettingItemInObsidian,
        incompleteValue: INCOMPLETE_EXCLUDE_PATH,
        pluginId: PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    // The reported symptom: no keystroke may raise the unhandled-error notice.
    expect(result.noticesWhileTyping.filter((text) => text.includes('unhandled error'))).toEqual([]);

    // The completed value is valid, so it saves and reports nothing.
    expect(result.savedExcludePaths).toContain(REPORTED_EXCLUDE_PATH);
    expect(result.validationMessageForCompleteValue).toBe('');

    // An un-parseable entry is surfaced rather than silently ignored.
    expect(result.validationMessageForIncompleteValue).toBe(`Invalid regular expression: ${INCOMPLETE_EXCLUDE_PATH}`);
  });
});
