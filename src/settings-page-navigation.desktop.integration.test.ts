import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: it drives the plugin settings tab, matching this plugin's established convention for
// settings-tab suites (no Android emulator is wired for them).
// Version coverage: it uses only the stable settings-tab DOM (`.setting-item` / `.setting-item-name` /
// `.setting-item-chevron`) and the public `app.setting` navigation, with no dependence on minified
// Obsidian internals, so verifying on public-latest is sufficient.
// Isolation: `npx vitest run --project integration-tests:desktop src/settings-page-navigation.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface NavigationResult {
  readonly allMergesRows: string[];
  readonly depthInsideSubPage: number;
  readonly frontmatterPropertiesRows: string[];
  readonly frontmatterRows: string[];
  readonly frontmatterSubheadings: string[];
  readonly mergeRows: string[];
  readonly mergeRowsAfterBack: string[];
  readonly mergeSubheadings: string[];
  readonly onOpen: string[];
  readonly pageDescription: null | string;
  readonly smartCutRows: string[];
  readonly smartCutSubheadings: string[];
  readonly subPageDescription: null | string;
  readonly swapRows: string[];
  readonly swapSubheadings: string[];
  readonly titleRows: string[];
}

// Issues #220-#226 turned the tab from sixteen stacked headers into a short list of pages, and issue #282
// turned every section INSIDE a page into a page of its own. This is the real-Obsidian half of
// `plugin-settings-tab.test.ts`: the unit test pins the DECLARED tree, and this one proves Obsidian actually
// renders it that way, that a page can be walked into, and that a page inside a page can be walked into and
// back out of again.
describe('settings page navigation', () => {
  it('should open folded to the page entries and reveal a page contents when one is opened', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }): Promise<NavigationResult> {
        /*
         * Under the transport's ~30s per-closure cap, not at it.
         * Eight waits share one ceiling: the tab rendering, then seven page opens through `openPage` - four
         * top-level pages and three nested ones. 8 x 2500 = 20_000, plus the short settles after each
         * navigation, stays well under the cap. Every wait here is a page opening, which is fast; a page
         * that has not opened in 2.5 s is not going to.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
        const RENDER_DELAY_IN_MILLISECONDS = 150;

        app.setting.open();
        app.setting.openTabById(pluginId);
        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
        if (!settingTab) {
          throw new Error('Settings tab was not found.');
        }

        await waitUntil({
          message: 'the settings tab did not render',
          predicate: () => settingTab.containerEl.querySelectorAll('.setting-item').length > 0,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const onOpen = rowNames();
        const pageDescription = describeEntry('Merge');

        await openPage('Merge', 'All merges');
        const mergeSubheadings = collectSubheadings();
        const mergeRows = currentPageRowNames();
        const subPageDescription = describeEntry('All merges');

        // Issue #282: the page inside the page. Opening it must stack on top of `Merge`, and closing it must
        // land back on `Merge` rather than on the top level - that is what makes it navigation rather than a
        // second way to reach the same rows.
        await openPage('All merges', 'Merge template');
        const allMergesRows = currentPageRowNames();
        const depthInsideSubPage = app.setting.pageStack.length;
        await closePage();
        const mergeRowsAfterBack = currentPageRowNames();
        await closePage();

        // Issue #241: a page that deliberately has no sections of its own besides its path rows.
        await openPage('Swap', 'Should ask before swapping');
        const swapSubheadings = collectSubheadings();
        const swapRows = currentPageRowNames();
        await closePage();

        // Issue #243: a page that MIXES a flat row with sections.
        await openPage('Smart cut & paste', 'Should lock all notes when marking selection');
        const smartCutSubheadings = collectSubheadings();
        const smartCutRows = currentPageRowNames();
        await closePage();

        // Issue #272: the page that ABSORBED another one. A row is not in the DOM until its page is opened,
        // so the waits below are themselves the proof that `Name transform template` left the retired
        // `Title` page and is reached through the `Title` section instead.
        await openPage('Frontmatter', 'Title');
        const frontmatterSubheadings = collectSubheadings();
        const frontmatterRows = currentPageRowNames();
        await openPage('Title', 'Name transform template');
        const titleRows = currentPageRowNames();
        await closePage();
        await openPage('Frontmatter properties', 'Frontmatter merge strategy');
        const frontmatterPropertiesRows = currentPageRowNames();
        await closePage();
        await closePage();
        app.setting.close();

        return {
          allMergesRows,
          depthInsideSubPage,
          frontmatterPropertiesRows,
          frontmatterRows,
          frontmatterSubheadings,
          mergeRows,
          mergeRowsAfterBack,
          mergeSubheadings,
          onOpen,
          pageDescription,
          smartCutRows,
          smartCutSubheadings,
          subPageDescription,
          swapRows,
          swapSubheadings,
          titleRows
        };

        async function closePage(): Promise<void> {
          app.setting.closePage();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        // A heading is a `.setting-item-heading` inside the page's `.setting-group`, NOT the group itself:
        // Obsidian wraps a page's rows in a `.setting-group` even when the page declares no group at all
        // (verified against the rendered `Swap` page), so counting groups reports a heading a flat page
        // does not have — it returned the first ROW's name. The positive half of this selector is the unit
        // test's `should render only the root heading`.
        function collectSubheadings(): string[] {
          return [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-item-heading .setting-item-name') ?? [])]
            .map((el) => el.textContent)
            .filter((heading) => heading !== '');
        }

        // Scoped to the page on screen: Obsidian keeps the page it came from in the DOM underneath, so a
        // modal-wide query would also return the rows of every page below it on the stack.
        function currentPageRowNames(): string[] {
          return [...(app.setting.getCurrentPageEl()?.querySelectorAll(':scope .setting-item-name') ?? [])]
            .map((el) => el.textContent)
            .filter((name) => name !== '');
        }

        function describeEntry(name: string): null | string {
          return findRow(name)?.querySelector(':scope .setting-item-description')?.textContent ?? null;
        }

        function findRow(name: string): HTMLElement | null {
          const rows = [...(getModalEl()?.querySelectorAll<HTMLElement>(':scope .setting-item') ?? [])];
          return rows.find((row) => row.querySelector(':scope .setting-item-name')?.textContent === name) ?? null;
        }

        function getModalEl(): Element | null {
          return activeDocument.querySelector('.modal.mod-settings');
        }

        async function openPage(name: string, rowOnPage: string): Promise<void> {
          const entry = findRow(name);
          if (!entry) {
            throw new Error(`The "${name}" page entry was not found.`);
          }

          entry.click();
          await waitUntil({
            message: `the "${name}" page did not open`,
            predicate: () => currentPageRowNames().includes(rowOnPage),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
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

    // Issue #221: the tab opens showing the entries, not eighty rows.
    expect(result.onOpen).toContain('Merge');
    expect(result.onOpen).toContain('Frontmatter');
    // Issue #271 retired the `Include/exclude` page and gave the two categories that had no page of their
    // own one each; every other category's path rows moved onto the page of its commands.
    expect(result.onOpen).not.toContain('Include/exclude');
    expect(result.onOpen).toContain('Select');
    expect(result.onOpen).toContain('Rename');
    // Issue #272: `Title` is no longer an entry of the top level — it lives INSIDE `Frontmatter`, and is not
    // in the DOM until that page is opened, which is what makes this assertion meaningful rather than vacuous.
    expect(result.onOpen).not.toContain('Title');
    expect(result.onOpen).not.toContain('Merge folders');
    expect(result.onOpen).not.toContain('Command include/exclude paths');
    // A row that lives inside a page is genuinely absent until that page is opened.
    expect(result.onOpen).not.toContain('Merge template');

    // Issue #224 asked for a description of what merging is on the expanded header; issue #282's sub-pages
    // carry one too, which is all the user sees of a section before clicking into it.
    expect(result.pageDescription).toContain('Merging');
    expect(result.subPageDescription).toContain('merge');

    // Issue #282: `Merge` holds no heading any more, only the five entries issues #240 and #271 gave it -
    // each of them a page to click into rather than a stretch of rows to scroll past.
    const MERGE_SECTIONS = [
      'All merges',
      'Merge file',
      'Merge folder contents into a single file',
      'Merge current folder with another folder',
      'Merge include/exclude paths'
    ];
    expect(result.mergeSubheadings).toEqual([]);
    expect(result.mergeRows).toEqual(MERGE_SECTIONS);
    // The sub-page stacks on top of `Merge`, and closing it lands back on `Merge`.
    expect(result.depthInsideSubPage).toBe(2);
    expect(result.mergeRowsAfterBack).toEqual(MERGE_SECTIONS);
    // Issue #220: the template leads its section.
    expect(result.allMergesRows[0]).toBe('Merge template');

    // Issue #241: `Swap` renders its own four rows flat; issue #271's path rows are its one section.
    expect(result.swapSubheadings).toEqual([]);
    expect(result.swapRows).toEqual([
      'Should ask before swapping',
      'Should include child folders when swapping folders',
      'Should include parent folders when swapping folders',
      'Should swap entire folder structure',
      'Swap include/exclude paths'
    ]);

    // Issue #272: the merged page, `Title` first; the rows of the retired `Title` page really are under it.
    expect(result.frontmatterSubheadings).toEqual([]);
    expect(result.frontmatterRows).toEqual(['Title', 'Frontmatter properties']);
    expect(result.titleRows).toEqual([
      'Name transform template',
      'Should replace invalid characters',
      'Replacement string',
      'Should treat title as path',
      // The three that moved off the old frontmatter set: they write or read the frontmatter `title`, which
      // is what the rows above exist to preserve when a name cannot become a file name.
      'Frontmatter title mode',
      'Should use source title when destination has none',
      'Should add invalid title to note aliases'
    ]);
    expect(result.frontmatterPropertiesRows).toEqual([
      'Frontmatter merge strategy',
      'Should include frontmatter when splitting',
      'Should extract a properties selection as properties'
    ]);

    // Issue #243: the lock row sits FLAT above the sections because it governs the mark rather than any one
    // notice or move direction. Obsidian renders a flat row and page entries on one page - the mixed shape
    // works, which is the whole point of asserting it here.
    expect(result.smartCutSubheadings).toEqual([]);
    expect(result.smartCutRows).toEqual([
      'Should lock all notes when marking selection',
      'Notice',
      'At cursor',
      'To top of file',
      'To bottom of file',
      'Smart cut & paste include/exclude paths'
    ]);
  });
});
