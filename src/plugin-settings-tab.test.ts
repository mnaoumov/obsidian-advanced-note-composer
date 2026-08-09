import type {
  BaseComponent,
  DropdownComponent,
  Plugin,
  SettingDefinition,
  SettingGroup,
  TextComponent,
  ToggleComponent
} from 'obsidian';
import type { DebugController } from 'obsidian-dev-utils/debug-controller';
import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { CodeHighlighterComponent } from 'obsidian-dev-utils/obsidian/setting-components/code-highlighter-component';

import {
  App,
  Setting
} from 'obsidian';
import { getDebugController } from 'obsidian-dev-utils/debug';
import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { SettingEx } from 'obsidian-dev-utils/obsidian/setting-ex';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { MergeFolderIntoFileLocation } from './plugin-settings.ts';

const PLUGIN_ID = 'test-plugin-id';

interface AppStatics {
  createConfigured__(): App;
}

interface DisabledPredicateRow {
  disabled?: (() => boolean) | boolean;
}

interface NamedComponent<T extends BaseComponent> {
  component: T;
  name: string;
}

interface NamedDesc {
  name: string;
  text: string;
}

interface TextBasedProbe {
  setPlaceholderValue?: unknown;
}

const headings: string[] = [];
const toggles: NamedComponent<ToggleComponent>[] = [];
const texts: NamedComponent<TextComponent>[] = [];
const dropdowns: NamedComponent<DropdownComponent>[] = [];
const codeHighlighters: NamedComponent<CodeHighlighterComponent>[] = [];
const descriptions: NamedDesc[] = [];

vi.mock('obsidian-dev-utils/debug', () => ({
  getDebugController: vi.fn().mockReturnValue({
    disable: vi.fn(),
    enable: vi.fn(),
    get: vi.fn().mockReturnValue([])
  })
}));

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', () => ({
  loadPrism: vi.fn(() =>
    Promise.resolve({
      highlightElement: vi.fn(),
      languages: {}
    })
  )
}));

vi.mock('./tokenized-string-language-component.ts', () => ({
  TOKENIZED_STRING_LANGUAGE: 'mock-language'
}));

beforeEach(() => {
  installSettingSpies();
});

afterEach(() => {
  vi.restoreAllMocks();
  headings.length = 0;
  toggles.length = 0;
  texts.length = 0;
  dropdowns.length = 0;
  codeHighlighters.length = 0;
  descriptions.length = 0;
});

async function createSettingsComponent(): Promise<PluginSettingsComponent> {
  const component = new PluginSettingsComponent({
    dataHandler: strictProxy<DataHandler>({
      loadData: vi.fn(() => Promise.resolve(null)),
      saveData: vi.fn(() => noopAsync())
    }),
    pluginEventSource: strictProxy<PluginEventSource>({
      on: vi.fn(() => castTo<ReturnType<PluginEventSource['on']>>({}))
    })
  });
  await component.loadWithPromises();
  return component;
}

async function createSettingsTab(pluginSettingsComponent?: PluginSettingsComponent): Promise<PluginSettingsTab> {
  const settingsComponent = pluginSettingsComponent ?? await createSettingsComponent();
  const app = castTo<AppStatics>(App).createConfigured__();
  const plugin = strictProxy<Plugin>({ app });
  return new PluginSettingsTab({
    plugin,
    pluginId: PLUGIN_ID,
    pluginSettingsComponent: settingsComponent
  });
}

function findCodeHighlighter(name: string): CodeHighlighterComponent {
  const entry = codeHighlighters.find((codeHighlighter) => codeHighlighter.name === name);
  if (!entry) {
    throw new Error(`Code highlighter "${name}" was not rendered.`);
  }

  return entry.component;
}

function findDesc(name: string): string {
  const entry = descriptions.find((desc) => desc.name === name);
  if (!entry) {
    throw new Error(`Description for "${name}" was not rendered.`);
  }

  return entry.text;
}

function findToggle(name: string): ToggleComponent {
  const entry = toggles.find((toggle) => toggle.name === name);
  if (!entry) {
    throw new Error(`Toggle "${name}" was not rendered.`);
  }

  return entry.component;
}

describe('PluginSettingsTab', () => {
  it('should be constructable with pluginId', async () => {
    const tab = await createSettingsTab();
    expect(tab).toBeInstanceOf(PluginSettingsTab);
  });

  it('should render all setting group headings in order', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(headings).toEqual([
      'Common',
      'Merge/split/extract strategies',
      'Title',
      'Merge',
      'Split/extract',
      'Swap',
      'Smart cut & paste',
      'Include/exclude paths',
      // Its own group rather than a row inside the one above (issue #198): it is a second, independent
      // Path filter, and burying it there is what made the two behaviors look like one setting.
      'Command include/exclude paths',
      'Merge folders',
      'Swap folders',
      'Move/flatten folders',
      'Create folder with notes',
      'UI'
    ]);
  });

  it('should render the expected named settings', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const allNames = [...toggles, ...texts, ...dropdowns].map((entry) => entry.name);
    expect(allNames).toContain('Should allow only current folder');
    expect(allNames).toContain('Should show console debug messages');
    expect(allNames).toContain('Should replace invalid characters');
    expect(allNames).toContain('Replacement string');
    expect(allNames).toContain('Frontmatter merge strategy');
    expect(allNames).toContain('Should use source title when destination has none');
    expect(allNames).toContain('Should add commands to submenu');
    expect(allNames).toContain('Merge folder into file location');
  });

  it('should offer the three merged-note locations, defaulting to the pre-#178 behavior', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const location = dropdowns.find((dropdown) => dropdown.name === 'Merge folder into file location');
    const options = [...(location?.component.selectEl.options ?? [])].map((option) => option.value);
    // In offered order: today's behavior first, then the two new positions (issue #178).
    expect(options).toStrictEqual([
      MergeFolderIntoFileLocation.BesideFolder,
      MergeFolderIntoFileLocation.InsideFolder,
      MergeFolderIntoFileLocation.DefaultNewNoteLocation
    ]);
  });

  it('should explain the path-string and regular-expression forms in the include/exclude path descriptions', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    // The command-visibility filter (issue #198) takes the same two entry forms, so it explains them too.
    for (const name of ['Include paths', 'Exclude paths', 'Command include paths', 'Command exclude paths']) {
      const desc = findDesc(name);
      expect(desc).toContain('A path string matches that note or folder and everything inside it');
      expect(desc).toContain('/^Inbox$/');
    }
  });

  // Issue #198 replaced the `Should block commands on excluded paths` toggle with its own path lists;
  // Two empty lists already mean "block nothing", so a master switch would only add an incoherent state.
  it('should render the command path lists instead of a blocking toggle', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findDesc('Command exclude paths')).toContain('Hide Advanced Note Composer commands');
    expect(findDesc('Command include paths')).toContain('Offer Advanced Note Composer commands only');
    expect(() => findToggle('Should block commands on excluded paths')).toThrow();
  });

  it('should render the show-modal-instructions toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should show modal instructions').getValue()).toBe(true);
  });

  it('should render the lock-all-notes toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should lock all notes when marking selection').getValue()).toBe(false);
  });

  it('should render the always-merge-excluded-items toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should always merge excluded items').getValue()).toBe(false);
  });

  it('should render the ask-before-swapping toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should ask before swapping').getValue()).toBe(true);
  });

  it('should render the jump-to-moved-content toggles bound to their settings', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should jump to content moved to top of file').getValue()).toBe(true);
    expect(findToggle('Should jump to content moved to bottom of file').getValue()).toBe(true);
  });

  it('should render the split-into-folder toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should split into folder').getValue()).toBe(false);
  });

  it('should render the split-into-folder note name highlighter bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findCodeHighlighter('Split into folder note name').getValue()).toBe('');
  });

  it('should render the split-headings-automatically toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should split headings automatically').getValue()).toBe(false);
  });

  it('should re-render settings when display is called twice', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);
    const firstRenderHeadings = headings.length;
    renderRows(tab);

    expect(headings.length).toBe(firstRenderHeadings * 2);
  });
});

describe('debug controller toggle', () => {
  it('should reflect the current debug-enabled state on the toggle', async () => {
    vi.mocked(getDebugController).mockReturnValue(castTo<DebugController>({
      disable: vi.fn(),
      enable: vi.fn(),
      get: vi.fn().mockReturnValue([PLUGIN_ID])
    }));

    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should show console debug messages').getValue()).toBe(true);
  });

  it('should enable debug controller when the debug toggle is switched on', async () => {
    const enableMock = vi.fn();
    const disableMock = vi.fn();
    vi.mocked(getDebugController).mockReturnValue(castTo<DebugController>({
      disable: disableMock,
      enable: enableMock,
      get: vi.fn().mockReturnValue([])
    }));

    const tab = await createSettingsTab();
    renderRows(tab);

    findToggle('Should show console debug messages').setValue(true);
    expect(enableMock).toHaveBeenCalledWith(PLUGIN_ID);
  });

  it('should disable debug controller when the debug toggle is switched off', async () => {
    const enableMock = vi.fn();
    const disableMock = vi.fn();
    vi.mocked(getDebugController).mockReturnValue(castTo<DebugController>({
      disable: disableMock,
      enable: enableMock,
      get: vi.fn().mockReturnValue([])
    }));

    const tab = await createSettingsTab();
    renderRows(tab);

    findToggle('Should show console debug messages').setValue(false);
    expect(disableMock).toHaveBeenCalledWith(PLUGIN_ID);
  });
});

describe('shouldReplaceInvalidTitleCharacters', () => {
  it('should enable the replacement text input when replacing invalid characters is on', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(isRowDisabled(tab, 'Replacement string')).toBe(false);
  });

  it('should disable the replacement text input when replacing invalid characters is off', async () => {
    const settingsComponent = await createSettingsComponent();
    castTo<PluginSettings>(settingsComponent.settings).shouldReplaceInvalidTitleCharacters = false;

    const tab = await createSettingsTab(settingsComponent);
    renderRows(tab);

    // The predicate is what the tab owns; Obsidian applies it — and propagates it to the row's
    // Components — on every render and on every `refreshDomState()`.
    expect(isRowDisabled(tab, 'Replacement string')).toBe(true);
  });

  it('should re-evaluate the predicates when the replace-invalid-characters toggle changes', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const refreshDomStateSpy = vi.fn();
    tab.refreshDomState = refreshDomStateSpy;
    // The toggle is bound with an `onChanged` handler that asks Obsidian to re-evaluate the predicates.
    // `bind` wires an async onChange, so it happens after the microtask flush.
    findToggle('Should replace invalid characters').setValue(false);

    await vi.waitFor(() => {
      expect(refreshDomStateSpy).toHaveBeenCalled();
    });
  });
});

type AddComponentFunction = (callback: (component: BaseComponent) => void) => Setting;
type AddComponentMethod = 'addDropdown' | 'addText' | 'addToggle';

/**
 * Flattens the declared items into the rows they contain, recording the group headings on the way.
 *
 * @param tab - The settings tab.
 * @param shouldRecordHeadings - Whether to record the headings.
 * @returns The declared rows.
 */
function collectRows(tab: PluginSettingsTab, shouldRecordHeadings = false): SettingDefinition[] {
  const rows: SettingDefinition[] = [];
  for (const item of tab.getSettingDefinitions()) {
    if ('items' in item) {
      if (shouldRecordHeadings && 'heading' in item) {
        headings.push(castTo<string>(item.heading));
      }

      rows.push(...castTo<SettingDefinition[]>(item.items ?? []));
    } else {
      rows.push(castTo<SettingDefinition>(item));
    }
  }

  return rows;
}

function installSettingSpies(): void {
  spyOnAdd('addToggle', toggles);
  spyOnAdd('addText', texts);
  spyOnAdd('addDropdown', dropdowns);
  spyOnAddCodeHighlighter();
  spyOnSetDesc();
}

/**
 * Evaluates a declared row's `disabled` predicate.
 *
 * @param tab - The settings tab.
 * @param name - The row name.
 * @returns Whether the row is disabled.
 */
function isRowDisabled(tab: PluginSettingsTab, name: string): boolean {
  const row = collectRows(tab).find((candidate) => 'name' in candidate && candidate.name === name);
  if (!row) {
    throw new Error(`Row "${name}" was not declared.`);
  }

  const disabled = castTo<DisabledPredicateRow>(row).disabled;
  if (typeof disabled === 'function') {
    return disabled();
  }

  return disabled ?? false;
}

/**
 * Renders the declared rows the way Obsidian does when the tab is opened: it applies the name and the
 * description, then runs the row's `render` callback.
 *
 * @param tab - The settings tab.
 */
function renderRows(tab: PluginSettingsTab): void {
  for (const row of collectRows(tab, true)) {
    if (!('render' in row)) {
      continue;
    }

    const setting = new SettingEx(tab.containerEl);
    setting.setName(row.name);
    if (row.desc) {
      setting.setDesc(row.desc);
    }

    row.render(setting, castTo<SettingGroup>(null));
  }
}

function spyOnAdd<T extends BaseComponent>(
  method: AddComponentMethod,
  registry: NamedComponent<T>[]
): void {
  const prototype = castTo<Record<AddComponentMethod, AddComponentFunction>>(Setting.prototype);
  const original = prototype[method];
  vi.spyOn(prototype, method).mockImplementation(function addComponentSpy(this: Setting, callback: (component: BaseComponent) => void): Setting {
    const name = this.nameEl.textContent;
    return original.call(this, (component: BaseComponent) => {
      // Mock value components lack the dev-utils text-based-component probe (`setPlaceholderValue`).
      // Assigning it stops the strict proxy from throwing and makes `bind` correctly treat them as non-text-based.
      castTo<TextBasedProbe>(component).setPlaceholderValue = undefined;
      registry.push({ component: castTo<T>(component), name });
      callback(component);
    });
  });
}

function spyOnAddCodeHighlighter(): void {
  const original = SettingEx.prototype.addCodeHighlighter;
  vi.spyOn(SettingEx.prototype, 'addCodeHighlighter').mockImplementation(
    function addCodeHighlighterSpy(this: SettingEx, callback: (component: CodeHighlighterComponent) => void): SettingEx {
      const name = this.nameEl.textContent;
      return original.call(this, (component: CodeHighlighterComponent) => {
        codeHighlighters.push({ component, name });
        callback(component);
      });
    }
  );
}

function spyOnSetDesc(): void {
  const original = Setting.prototype.setDesc;
  vi.spyOn(Setting.prototype, 'setDesc').mockImplementation(function setDescSpy(this: Setting, desc: DocumentFragment | string): Setting {
    const result = original.call(this, desc);
    descriptions.push({
      name: this.nameEl.textContent,
      text: this.descEl.textContent
    });
    return result;
  });
}
