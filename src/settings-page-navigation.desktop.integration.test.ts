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
  readonly smartCutRows: string[];
  readonly smartCutSubheadings: string[];
  readonly swapRows: string[];
  readonly swapSubheadings: string[];
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
        const mergeSubheadings = collectSubheadings();
        const mergeFolderRows = [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-item-name') ?? [])]
          .map((el) => el.textContent)
          .filter((name) => name !== '');

        app.setting.closePage();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Issue #241: the other half of the comparison — a page that deliberately has NO subheadings.
        const swapEntry = findRow('Swap');
        if (!swapEntry) {
          throw new Error('The `Swap` page entry was not found.');
        }

        swapEntry.click();
        await waitUntil({
          message: 'the `Swap` page did not open',
          predicate: () => findRow('Should ask before swapping') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const swapSubheadings = collectSubheadings();
        const swapRows = [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-item-name') ?? [])]
          .map((el) => el.textContent)
          .filter((name) => name !== '');

        app.setting.closePage();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Issue #243: the third shape — a page that MIXES a flat row with groups. Neither of the two above
        // Proves Obsidian renders such a page at all, and the unit test cannot: it only sees the declared
        // Tree.
        const smartCutEntry = findRow('Smart cut & paste');
        if (!smartCutEntry) {
          throw new Error('The `Smart cut & paste` page entry was not found.');
        }

        smartCutEntry.click();
        await waitUntil({
          message: 'the `Smart cut & paste` page did not open',
          predicate: () => findRow('Should lock all notes when marking selection') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const smartCutSubheadings = collectSubheadings();
        const smartCutRows = [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-item-name') ?? [])]
          .map((el) => el.textContent)
          .filter((name) => name !== '');

        app.setting.closePage();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        app.setting.close();

        return { mergeFolderRows, mergeSubheadings, onOpen, pageDescription, smartCutRows, smartCutSubheadings, swapRows, swapSubheadings };

        // A heading is a `.setting-item-heading` inside the page's `.setting-group`, NOT the group itself:
        // Obsidian wraps a page's rows in a `.setting-group` even when the page declares no group at all
        // (verified against the rendered `Swap` page), so counting groups reports a heading a flat page
        // Does not have — it returned the first ROW's name. Both pages are measured with this one
        // Function, which is what keeps the empty `Swap` result from passing vacuously on a dead selector.
        function collectSubheadings(): string[] {
          return [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-item-heading .setting-item-name') ?? [])]
            .map((el) => el.textContent)
            .filter((heading) => heading !== '');
        }

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

    // Issue #221: the tab opens showing the entries, not eighty rows. `Merge folders` is gone as a
    // Top-level header — it is a subheading of `Merge` now (issues #224/#240). `Swap` had the same
    // Treatment from issue #226 and lost it again to issue #241: its four rows are flat on its page.
    expect(result.onOpen).toContain('Merge');
    expect(result.onOpen).toContain('Frontmatter');
    // Issue #271 retired the `Include/exclude` page and gave the two categories that had no page of their
    // Own one each; every other category's path rows moved onto the page of its commands.
    expect(result.onOpen).not.toContain('Include/exclude');
    expect(result.onOpen).toContain('Select');
    expect(result.onOpen).toContain('Rename');
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
      'Merge current folder with another folder',
      // Issue #271 moved the Merge category's four path rows onto this page, under a heading of their own.
      'Merge include/exclude paths'
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

    // Issue #241: `Swap` renders its own four rows with no subheading of their own — the shared
    // Confirmation row belonged under neither of the two issue #226 had put there. Issue #271 then added
    // The category's path group below them, which is the page's only heading. Asserted in real Obsidian
    // Because the unit test can only pin the DECLARED tree, and a page's rows are not in the DOM until it
    // Is opened — the mixed flat-rows-then-a-group shape is exactly what needs confirming here.
    expect(result.swapSubheadings).toEqual(['Swap include/exclude paths']);
    expect(result.swapRows).toEqual([
      'Should ask before swapping',
      'Should include child folders when swapping folders',
      'Should include parent folders when swapping folders',
      'Should swap entire folder structure',
      'Swap include/exclude paths',
      'Swap include paths',
      'Swap exclude paths',
      'Swap command include paths',
      'Swap command exclude paths'
    ]);

    // Issue #243: the lock row moved here off `Split/extract`, and it sits FLAT above the groups because
    // It governs the mark rather than any one notice or move direction. Obsidian renders it before the
    // First subheading — the mixed shape works, which is the whole point of asserting it here.
    expect(result.smartCutRows[0]).toBe('Should lock all notes when marking selection');
    expect(result.smartCutRows[1]).toBe('Notice');
    expect(result.smartCutSubheadings).toEqual([
      'Notice',
      'At cursor',
      'To top of file',
      'To bottom of file',
      'Smart cut & paste include/exclude paths'
    ]);
  });
});
