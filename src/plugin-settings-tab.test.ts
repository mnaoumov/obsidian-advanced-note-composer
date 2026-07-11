import type {
  BaseComponent,
  DropdownComponent,
  Plugin,
  TextComponent,
  ToggleComponent
} from 'obsidian';
import type { DebugController } from 'obsidian-dev-utils/debug-controller';
import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import {
  App,
  Setting
} from 'obsidian';
import { getDebugController } from 'obsidian-dev-utils/debug';
import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { SettingGroupEx } from 'obsidian-dev-utils/obsidian/setting-group-ex';
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

const PLUGIN_ID = 'test-plugin-id';

interface AppStatics {
  createConfigured__(): App;
}

interface NamedComponent<T extends BaseComponent> {
  component: T;
  name: string;
}

interface TextBasedProbe {
  setPlaceholderValue?: unknown;
}

const headings: string[] = [];
const toggles: NamedComponent<ToggleComponent>[] = [];
const texts: NamedComponent<TextComponent>[] = [];
const dropdowns: NamedComponent<DropdownComponent>[] = [];

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

vi.mock('./prism-component.ts', () => ({
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

function findText(name: string): TextComponent {
  const entry = texts.find((text) => text.name === name);
  if (!entry) {
    throw new Error(`Text "${name}" was not rendered.`);
  }

  return entry.component;
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
    tab.displayLegacy();

    expect(headings).toEqual([
      'Common',
      'Merge/split/extract strategies',
      'Title',
      'Merge',
      'Split/extract',
      'Include/exclude paths',
      'Merge folders',
      'Swap folders',
      'UI'
    ]);
  });

  it('should render the expected named settings', async () => {
    const tab = await createSettingsTab();
    tab.displayLegacy();

    const allNames = [...toggles, ...texts, ...dropdowns].map((entry) => entry.name);
    expect(allNames).toContain('Should allow only current folder');
    expect(allNames).toContain('Should show console debug messages');
    expect(allNames).toContain('Should replace invalid characters');
    expect(allNames).toContain('Replacement string');
    expect(allNames).toContain('Frontmatter merge strategy');
    expect(allNames).toContain('Should use source title when destination has none');
    expect(allNames).toContain('Should add commands to submenu');
  });

  it('should render the show-modal-instructions toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    tab.displayLegacy();

    expect(findToggle('Should show modal instructions').getValue()).toBe(true);
  });

  it('should render the lock-all-notes toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    tab.displayLegacy();

    expect(findToggle('Should lock all notes when marking selection').getValue()).toBe(false);
  });

  it('should re-render settings when display is called twice', async () => {
    const tab = await createSettingsTab();
    tab.displayLegacy();
    const firstRenderHeadings = headings.length;
    tab.displayLegacy();

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
    tab.displayLegacy();

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
    tab.displayLegacy();

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
    tab.displayLegacy();

    findToggle('Should show console debug messages').setValue(false);
    expect(disableMock).toHaveBeenCalledWith(PLUGIN_ID);
  });
});

describe('shouldReplaceInvalidTitleCharacters', () => {
  it('should enable the replacement text input when replacing invalid characters is on', async () => {
    const tab = await createSettingsTab();
    tab.displayLegacy();

    expect(findText('Replacement string').disabled).toBe(false);
  });

  it('should disable the replacement text input when replacing invalid characters is off', async () => {
    const settingsComponent = await createSettingsComponent();
    castTo<PluginSettings>(settingsComponent.settings).shouldReplaceInvalidTitleCharacters = false;

    const tab = await createSettingsTab(settingsComponent);
    tab.displayLegacy();

    expect(findText('Replacement string').disabled).toBe(true);
  });

  it('should re-render the tab when the replace-invalid-characters toggle changes', async () => {
    const tab = await createSettingsTab();
    tab.displayLegacy();

    const displaySpy = vi.spyOn(tab, 'displayLegacy');
    // The toggle is bound with an `onChanged` handler that re-invokes `displayLegacy`.
    // `bind` wires an async onChange, so the re-render happens after the microtask flush.
    findToggle('Should replace invalid characters').setValue(false);

    await vi.waitFor(() => {
      expect(displaySpy).toHaveBeenCalled();
    });
  });
});

type AddComponentFn = (cb: (component: BaseComponent) => void) => Setting;
type AddComponentMethod = 'addDropdown' | 'addText' | 'addToggle';

function installSettingSpies(): void {
  const originalSetHeading = SettingGroupEx.prototype.setHeading;
  vi.spyOn(SettingGroupEx.prototype, 'setHeading').mockImplementation(function setHeadingSpy(this: SettingGroupEx, heading: DocumentFragment | string): SettingGroupEx {
    headings.push(castTo<string>(heading));
    return originalSetHeading.call(this, heading);
  });

  spyOnAdd('addToggle', toggles);
  spyOnAdd('addText', texts);
  spyOnAdd('addDropdown', dropdowns);
}

function spyOnAdd<T extends BaseComponent>(
  method: AddComponentMethod,
  registry: NamedComponent<T>[]
): void {
  const prototype = castTo<Record<AddComponentMethod, AddComponentFn>>(Setting.prototype);
  const original = prototype[method];
  vi.spyOn(prototype, method).mockImplementation(function addComponentSpy(this: Setting, cb: (component: BaseComponent) => void): Setting {
    const name = this.nameEl.textContent;
    return original.call(this, (component: BaseComponent) => {
      // Mock value components lack the dev-utils text-based-component probe (`setPlaceholderValue`).
      // Assigning it stops the strict proxy from throwing and makes `bind` correctly treat them as non-text-based.
      castTo<TextBasedProbe>(component).setPlaceholderValue = undefined;
      registry.push({ component: castTo<T>(component), name });
      cb(component);
    });
  });
}
