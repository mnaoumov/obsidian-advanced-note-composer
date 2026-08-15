import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: it drives the plugin settings tab, matching this plugin's established convention for
// Settings-tab suites (no Android emulator is wired for them).
// G99: it uses only the stable settings-tab DOM (`.setting-item` / `.setting-item-name` /
// `.setting-item-chevron`) and the public `app.setting` navigation, with no dependence on minified
// Obsidian internals, so verifying on public-latest is sufficient.
// Isolation: `npx vitest run --project integration-tests:desktop src/settings-page-navigation.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface NavigationResult {
  readonly mergeFolderRows: string[];
  readonly mergeSubheadings: string[];
  readonly onOpen: string[];
  readonly pageDescription: null | string;
}

// Issues #220-#226 turned the tab from sixteen stacked headers into a short list of pages. This is the
// Real-Obsidian half of `plugin-settings-tab.test.ts`: the unit test pins the DECLARED tree, and this one
// Proves Obsidian actually renders it that way and that a page can be walked into.
describe('settings page navigation', () => {
  it('should open folded to the page entries and reveal a page contents when one is opened', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }): Promise<NavigationResult> {
        const RENDER_DELAY_IN_MILLISECONDS = 150;

        app.setting.open();
        app.setting.openTabById(pluginId);
        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
        if (!settingTab) {
          throw new Error('Settings tab was not found.');
        }

        await waitUntil({
          message: 'the settings tab did not render',
          predicate: () => settingTab.containerEl.querySelectorAll('.setting-item').length > 0
        });

        const onOpen = rowNames();

        const mergeEntry = findRow('Merge');
        if (!mergeEntry) {
          throw new Error('The `Merge` page entry was not found.');
        }

        const pageDescription = mergeEntry.querySelector(':scope .setting-item-description')?.textContent ?? null;
        mergeEntry.click();
        await waitUntil({
          message: 'the `Merge` page did not open',
          predicate: () => findRow('Merge template') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Scoped to the page on screen: Obsidian keeps the page it came from in the DOM underneath, so a
        // Modal-wide query would also return the top-level headings.
        const mergeSubheadings = [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-group') ?? [])]
          .map((group) => group.querySelector(':scope .setting-item-name')?.textContent ?? '')
          .filter((heading) => heading !== '');
        const mergeFolderRows = [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-item-name') ?? [])]
          .map((el) => el.textContent)
          .filter((name) => name !== '');

        app.setting.closePage();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        app.setting.close();

        return { mergeFolderRows, mergeSubheadings, onOpen, pageDescription };

        function findRow(name: string): HTMLElement | null {
          const rows = [...(getModalEl()?.querySelectorAll<HTMLElement>(':scope .setting-item') ?? [])];
          return rows.find((row) => row.querySelector(':scope .setting-item-name')?.textContent === name) ?? null;
        }

        function getModalEl(): Element | null {
          return activeDocument.querySelector('.modal.mod-settings');
        }

        function rowNames(): string[] {
          return [...(getModalEl()?.querySelectorAll(':scope .setting-item-name') ?? [])]
            .map((el) => el.textContent)
            .filter((name) => name !== '');
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Issue #221: the tab opens showing the entries, not eighty rows. `Merge folders` and `Swap folders`
    // Are gone as top-level headers — they are subheadings of `Merge` and `Swap` now (issues #224/#226).
    expect(result.onOpen).toContain('Merge');
    expect(result.onOpen).toContain('Frontmatter');
    expect(result.onOpen).toContain('Include/exclude');
    expect(result.onOpen).not.toContain('Merge folders');
    expect(result.onOpen).not.toContain('Command include/exclude paths');
    // A row that lives inside a page is genuinely absent until that page is opened.
    expect(result.onOpen).not.toContain('Merge template');

    // Issue #224 asked for a description of what merging is on the expanded header.
    expect(result.pageDescription).toContain('Merging');

    // Issue #224 gave the page two subheadings; issue #240 resplit them into four, because `Merge folder`
    // Covered two different commands and each of its rows belongs to exactly one of them.
    expect(result.mergeSubheadings).toEqual([
      'All merges',
      'Merge file',
      'Merge folder contents into a single file',
      'Merge current folder with another folder'
    ]);

    // Issue #220: the template leads its header.
    const firstSharedRow = result.mergeFolderRows[result.mergeFolderRows.indexOf('All merges') + 1];
    expect(firstSharedRow).toBe('Merge template');
    const firstMergeFolderIntoFileRow = result.mergeFolderRows[result.mergeFolderRows.indexOf('Merge folder contents into a single file') + 1];
    expect(firstMergeFolderIntoFileRow).toBe('Merge folder into file note name');

    // Issue #240: the one row of the whole-folder merge that used to sit among the into-a-single-file
    // Ones is now under the header that names its own command.
    const firstMergeFolderWithFolderRow = result.mergeFolderRows[result.mergeFolderRows.indexOf('Merge current folder with another folder') + 1];
    expect(firstMergeFolderWithFolderRow).toBe('Should include child folders when merging folders');
  });
});
