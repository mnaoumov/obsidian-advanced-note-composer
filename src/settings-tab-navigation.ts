/**
 * @file
 *
 * Locates a row in this plugin's settings tab from inside an `evalInObsidian` closure.
 *
 * Since issues #220-#226 every section of the tab is a `SettingDefinitionPage`, so most rows are not in
 * the DOM until their page is opened — and while a page IS open, `settingTab.containerEl` is DETACHED and
 * still holds the top-level entries rather than the rows on screen. A test that queries `containerEl` for
 * a row therefore finds nothing, whatever it waits for.
 *
 * {@link findSettingItemInObsidian} hides both facts: it asks the tab's own declarations which page holds
 * the row, opens that one, and leaves it open so the caller can drive the row.
 *
 * It is passed into a closure through `evalInObsidian`'s `input` (functions are serialized with their
 * source, so it runs inside Obsidian) and must stay SELF-CONTAINED — an import or a module-scope constant
 * referenced from its body is not serialized with it, and would throw a `ReferenceError` in the renderer.
 */

import type {
  App,
  SettingDefinitionItem
} from 'obsidian';

/**
 * Params for {@link findSettingItemInObsidian}.
 */
export interface FindSettingItemInObsidianParams {
  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * The `name` of the row to find, exactly as the settings tab declares it.
   */
  readonly name: string;

  /**
   * The already-opened plugin settings tab.
   */
  readonly settingTab: NavigableSettingTab;
}

/**
 * The part of the settings tab {@link findSettingItemInObsidian} reads — narrow enough that a test can
 * pass whatever `app.setting.pluginTabs` gave it.
 */
export interface NavigableSettingTab {
  /**
   * The tab's own container, which holds the page entries even while a page is open.
   */
  readonly containerEl: HTMLElement;

  /**
   * The declared tree, which is what says WHICH page a row lives on.
   *
   * @returns The setting definitions.
   */
  getSettingDefinitions(): SettingDefinitionItem[];
}

/* v8 ignore start -- Serialized via toString() and executed inside Obsidian, not callable in unit tests. */
/**
 * Finds a settings row by name, opening the page that holds it when it is not already on screen.
 *
 * @param params - The params.
 * @returns The row element, or `null` when no page holds a row with that name.
 */
export async function findSettingItemInObsidian(params: FindSettingItemInObsidianParams): Promise<HTMLElement | null> {
  const { app, name, settingTab } = params;
  const RENDER_DELAY_IN_MILLISECONDS = 150;

  function findRow(rowName: string): HTMLElement | null {
    const modalEl = activeDocument.querySelector('.modal.mod-settings');
    const rows = [...(modalEl?.querySelectorAll<HTMLElement>(':scope .setting-item') ?? [])];
    return rows.find((row) => row.querySelector(':scope .setting-item-name')?.textContent === rowName) ?? null;
  }

  function hasRow(items: SettingDefinitionItem[]): boolean {
    return items.some((item) => {
      if ('items' in item) {
        return hasRow(item.items ?? []);
      }

      return 'name' in item && item.name === name;
    });
  }

  // Ask the declarations which page holds the row, rather than opening every page until it turns up: a
  // Suite that flips several settings pays that walk on every single lookup, which is what timed out
  // `smart-cut-notice-settings` at 30 s.
  function findPageName(): null | string {
    for (const item of settingTab.getSettingDefinitions()) {
      // A page carries a `name`; a group carries a `heading` instead.
      if (!('items' in item) || !('name' in item)) {
        continue;
      }

      if (hasRow(item.items ?? [])) {
        return item.name;
      }
    }

    return null;
  }

  // Start from the top level whatever an earlier lookup left open.
  while (app.setting.pageStack.length > 0) {
    app.setting.closePage();
    await sleep(RENDER_DELAY_IN_MILLISECONDS);
  }

  const directMatch = findRow(name);
  if (directMatch) {
    return directMatch;
  }

  const pageName = findPageName();
  if (pageName === null) {
    return null;
  }

  // Looked up by name rather than kept as an element: navigating re-renders the tab and detaches it.
  const entry = findRow(pageName);
  if (!entry) {
    return null;
  }

  entry.click();
  await sleep(RENDER_DELAY_IN_MILLISECONDS);
  return findRow(name);
}
/* v8 ignore stop */
