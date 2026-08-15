import type {
  BaseComponent,
  DropdownComponent,
  Plugin,
  SettingDefinition,
  SettingDefinitionGroup,
  SettingDefinitionItem,
  SettingDefinitionPage,
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
import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
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
import {
  MergeFolderIntoFileLocation,
  SplitTargetMode
} from './plugin-settings.ts';

const PLUGIN_ID = 'test-plugin-id';

/**
 * `Folder note` is the deliberate exception to issue #220's template-first rule: its location dropdown
 * decides whether the templates below it apply at all — and disables the name row outright while the
 * location is `Auto` — so putting a disabled template above the setting that disables it would read
 * backwards.
 */
const TEMPLATE_FIRST_EXCEPTIONS = new Set(['Folder note']);

const TOP_LEVEL_LABEL = 'top level';

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

  // Issue #221 asked for collapsible headers, collapsed on open. Obsidian 1.13 has no collapsible groups
  // And its groups do not nest, so each section is a navigable PAGE instead: the tab opens as a short
  // List of entries, and a page holding groups is the two-level hierarchy issues #224/#225/#226 wanted.
  it('should open as two inline groups followed by the page entries', async () => {
    const tab = await createSettingsTab();

    expect(collectTopLevel(tab)).toEqual([
      'group:Common',
      'group:Merge/split/extract strategies',
      'page:Merge',
      'page:Split/extract',
      'page:Swap',
      'page:Smart cut & paste',
      // Its own page rather than rows scattered across three others (issue #223).
      'page:Frontmatter',
      'page:Title',
      // One page over what used to be two top-level headers (issue #225); the second path filter is still
      // Independent of the first (issue #198), it is now its own subheading rather than its own header.
      'page:Include/exclude',
      'page:Move/flatten folders',
      'page:Create folder with notes',
      // Its own page rather than rows inside `Reorder` (issue #216): what a folder note IS also answers
      // Issue #217's rename, so it is not a reorder detail.
      'page:Folder note',
      'page:Reorder',
      'page:UI'
    ]);
  });

  it('should give the merge, swap, smart cut and path pages their subheadings', async () => {
    const tab = await createSettingsTab();

    expect(collectPageSubheadings(tab)).toEqual({
      'Create folder with notes': [],
      'Folder note': [],
      'Frontmatter': [],
      // Issue #225.
      'Include/exclude': ['Paths', 'Commands'],
      // Issue #224, resplit by issue #240: one `Merge folder` header sat over two different commands, so
      // Six of its ten rows silently meant only the one their descriptions named.
      'Merge': ['All merges', 'Merge file', 'Merge folder contents into a single file', 'Merge current folder with another folder'],
      'Move/flatten folders': [],
      'Reorder': [],
      // Issue #222: each notice button and jump toggle sits under the template of the move it belongs to.
      'Smart cut & paste': ['Notice', 'At cursor', 'To top of file', 'To bottom of file'],
      'Split/extract': [],
      // Issue #226 gave this page `Swap file` / `Swap folders`; issue #241 took them away again. The
      // Shared `Should ask before swapping` row belonged to neither, `Swap file` held nothing else, and
      // The folder rows name their own target type — so the headings only mislabelled the first row.
      'Swap': [],
      'Title': [],
      'UI': []
    });
  });

  it('should render every heading exactly once', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(headings).toEqual([
      'Common',
      'Merge/split/extract strategies',
      'All merges',
      'Merge file',
      'Merge folder contents into a single file',
      'Merge current folder with another folder',
      'Notice',
      'At cursor',
      'To top of file',
      'To bottom of file',
      'Paths',
      'Commands'
    ]);
  });

  // Issue #220: every header that has a template leads with it, so the templates stop reading as though
  // They were placed at random.
  it('should lead every header that has a template with its templates', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const templateNames = new Set(codeHighlighters.map((codeHighlighter) => codeHighlighter.name));
    const offenders: string[] = [];
    for (const [label, rowNames] of collectContainers(tab)) {
      if (TEMPLATE_FIRST_EXCEPTIONS.has(label)) {
        continue;
      }

      const lastTemplateIndex = rowNames.findLastIndex((name) => templateNames.has(name));
      const firstPlainIndex = rowNames.findIndex((name) => !templateNames.has(name));
      if (lastTemplateIndex !== -1 && firstPlainIndex !== -1 && firstPlainIndex < lastTemplateIndex) {
        offenders.push(`${label}: ${rowNames.join(' | ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  // Issue #223 named no settings, only screenshots — these six are everything that reads or writes
  // Frontmatter, drawn out of three headers that each held a couple of them.
  it('should gather the frontmatter settings onto their own page', async () => {
    const tab = await createSettingsTab();

    expect(collectContainers(tab).get('Frontmatter')).toEqual([
      'Frontmatter merge strategy',
      'Frontmatter title mode',
      'Should use source title when destination has none',
      'Should add invalid title to note aliases',
      'Should include frontmatter when splitting',
      'Should extract a properties selection as properties'
    ]);
  });

  // Issue #241: the four swap rows sit directly on the page. The subheading assertion above proves the
  // Groups are gone; this one proves the rows survived the flattening in their original order, so a row
  // Added later cannot quietly bring a heading back with it.
  it('should list the swap settings flat on their page', async () => {
    const tab = await createSettingsTab();

    expect(collectContainers(tab).get('Swap')).toEqual([
      'Should ask before swapping',
      'Should include child folders when swapping folders',
      'Should include parent folders when swapping folders',
      'Should swap entire folder structure'
    ]);
  });

  // Issue #240: the reporter read a description under `Merge folder` that named only
  // `Merge folder contents into a single file...` and concluded the OTHER folder merge was undocumented.
  // It was not — one header sat over both commands. Every row now belongs to the header naming the
  // Command that reads it, and this is the assertion that keeps it that way: a row added to the wrong
  // Group fails here rather than quietly reintroducing the ambiguity.
  it('should split the merge page by the command each row belongs to', async () => {
    const tab = await createSettingsTab();
    const containers = collectContainers(tab);

    expect(containers.get('All merges')).toEqual([
      'Merge template',
      'Should ask before merging',
      'Should always merge excluded items',
      'Attachment extensions'
    ]);
    expect(containers.get('Merge file')).toEqual([
      'Should open note after merge',
      'Should move attachments when merging a file'
    ]);
    expect(containers.get('Merge folder contents into a single file')).toEqual([
      'Merge folder into file note name',
      'Merge folder into file location',
      'Should convert folders to headings when merging a folder',
      'Should move attachments when merging a folder',
      'Empty folders after merging a folder',
      'Should open the merged note after merging folder contents into a single file'
    ]);
    expect(containers.get('Merge current folder with another folder')).toEqual([
      'Should include child folders when merging folders',
      'Should include parent folders when merging folders',
      'Should open the first note after merging folders'
    ]);
  });

  // The half of issue #240 that a header alone cannot fix: a row under a command-named header must not
  // Describe itself in terms of a DIFFERENT command, which is what sent the reporter looking.
  it('should name only its own command in each folder-merge description', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const containers = collectContainers(tab);
    for (const rowName of containers.get('Merge current folder with another folder') ?? []) {
      // Asserted first so the negative below cannot pass vacuously on an unrendered description.
      expect(findDesc(rowName)).not.toBe('');
      expect(findDesc(rowName)).toContain('Merge current folder with another folder');
      expect(findDesc(rowName)).not.toContain('Merge folder contents into a single file');
    }

    for (const rowName of containers.get('Merge folder contents into a single file') ?? []) {
      expect(findDesc(rowName)).not.toBe('');
      expect(findDesc(rowName)).not.toContain('Merge current folder with another folder');
    }
  });

  it('should keep the folder-note location above the templates it governs', async () => {
    const tab = await createSettingsTab();

    expect(collectContainers(tab).get('Folder note')).toEqual([
      'Folder note location',
      'Folder note name template',
      'Folder note title template',
      'Folder note aliases template'
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
    // Issue #238: the opt-in that turns "name it, then it lands somewhere" into "name it, then say where".
    expect(allNames).toContain('Should ask for the target folder when splitting');
  });

  // Issue #238. The prompt is opt-in on purpose: the common case is a heading-driven extract whose name is
  // Already in the box, and a second modal on that path would cost everyone more than the bug costs anyone.
  it('should leave the target folder prompt off by default', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const prompt = toggles.find((toggle) => toggle.name === 'Should ask for the target folder when splitting');
    expect(prompt?.component.getValue()).toBe(false);
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

  // Issue #227: the split/extract picker's `Create`/`Merge` switch starts in the mode this setting names,
  // And `Create` is what the picker did before the switch existed whenever the typed name matched nothing.
  it('should offer both split target modes, defaulting to create', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const mode = dropdowns.find((dropdown) => dropdown.name === 'Default split target mode');
    const options = [...(mode?.component.selectEl.options ?? [])].map((option) => option.value);
    expect(options).toStrictEqual([SplitTargetMode.Create, SplitTargetMode.Merge]);
    expect(mode?.component.getValue()).toBe(SplitTargetMode.Create);
  });

  // Issue #227: every template that resolves the note-flavored vocabulary now also resolves the
  // `Create folder with notes...` folder tokens, so each of their descriptions has to say so — a token
  // Nobody knows about is a token nobody uses.
  it('should list the folder tokens in every note template description', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    for (const name of ['Merge template', 'Split template', 'Smart cut & paste template', 'Split into folder note name']) {
      const desc = findDesc(name);
      expect(desc).toContain('{{folderName}}');
      expect(desc).toContain('{{safeFolderName}}');
      expect(desc).toContain('{{index}}');
      expect(desc).toContain('{{parentFolderPath}}');
      // The two the vocabulary deliberately does not carry over are named as unavailable, rather than
      // Left to fail at split time.
      expect(desc).toContain('{{rawFolderName}}');
      expect(desc).toContain('are not available');
    }
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

  it('should render the per-operation-overrides toggle bound to its setting', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(findToggle('Should show per-operation option overrides').getValue()).toBe(true);
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

  it('should render the create-folder rename-button toggles bound to their settings', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    // Issue #214 makes the issue-#200 buttons optional, never withdrawn — so both default to shown.
    expect(findToggle('Should show rename button for the created folder').getValue()).toBe(true);
    expect(findToggle('Should show rename button for created notes').getValue()).toBe(true);
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

  it('should offer every folder-note location, Auto first', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const location = dropdowns.find((dropdown) => dropdown.name === 'Folder note location');
    const options = [...(location?.component.selectEl.options ?? [])].map((option) => option.value);
    expect(options).toStrictEqual([
      FolderNoteLocation.Auto,
      FolderNoteLocation.InsideFolder,
      FolderNoteLocation.None,
      FolderNoteLocation.ParentFolder
    ]);
  });

  it('should disable the folder-note name row while the location is Auto, that plugin supplying the name', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    expect(isRowDisabled(tab, 'Folder note name template')).toBe(true);
  });

  it('should enable the folder-note name row once a location is chosen explicitly', async () => {
    const settingsComponent = await createSettingsComponent();
    castTo<PluginSettings>(settingsComponent.settings).folderNoteLocation = FolderNoteLocation.ParentFolder;

    const tab = await createSettingsTab(settingsComponent);
    renderRows(tab);

    expect(isRowDisabled(tab, 'Folder note name template')).toBe(false);
  });

  it('should re-evaluate the predicates when the folder-note location changes', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const refreshDomStateSpy = vi.fn();
    tab.refreshDomState = refreshDomStateSpy;
    const location = dropdowns.find((dropdown) => dropdown.name === 'Folder note location');
    location?.component.setValue(FolderNoteLocation.InsideFolder);

    await vi.waitFor(() => {
      expect(refreshDomStateSpy).toHaveBeenCalled();
    });
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

// Issue #214: the two rename-button rows only mean anything while the confirmation dialog is shown, so
// They follow `shouldAskBeforeCreatingFolder` the way the replacement string follows its own toggle.
describe('shouldAskBeforeCreatingFolder', () => {
  const RENAME_BUTTON_ROW_NAMES = [
    'Should show rename button for the created folder',
    'Should show rename button for created notes'
  ];

  it('should disable the rename-button rows while the confirmation dialog is off', async () => {
    // Off is the DEFAULT for this flow, unlike every other `shouldAskBefore*`.
    const tab = await createSettingsTab();
    renderRows(tab);

    for (const name of RENAME_BUTTON_ROW_NAMES) {
      expect(isRowDisabled(tab, name)).toBe(true);
    }
  });

  it('should enable the rename-button rows once the confirmation dialog is on', async () => {
    const settingsComponent = await createSettingsComponent();
    castTo<PluginSettings>(settingsComponent.settings).shouldAskBeforeCreatingFolder = true;

    const tab = await createSettingsTab(settingsComponent);
    renderRows(tab);

    for (const name of RENAME_BUTTON_ROW_NAMES) {
      expect(isRowDisabled(tab, name)).toBe(false);
    }
  });

  it('should re-evaluate the predicates when the ask-before-creating toggle changes', async () => {
    const tab = await createSettingsTab();
    renderRows(tab);

    const refreshDomStateSpy = vi.fn();
    tab.refreshDomState = refreshDomStateSpy;
    // `bind` wires an async onChange, so the refresh happens after the microtask flush.
    findToggle('Should ask before creating a folder').setValue(true);

    await vi.waitFor(() => {
      expect(refreshDomStateSpy).toHaveBeenCalled();
    });
  });
});

type AddComponentFunction = (callback: (component: BaseComponent) => void) => Setting;
type AddComponentMethod = 'addDropdown' | 'addText' | 'addToggle';

/**
 * Describes the containers a row can sit in — every group, plus every page's own direct rows — as the
 * ordered row names they hold. What the issue-#220 invariant is asserted against.
 *
 * @param tab - The settings tab.
 * @returns The containers, keyed by the heading or page name that labels them.
 */
function collectContainers(tab: PluginSettingsTab): Map<string, string[]> {
  const containers = new Map<string, string[]>();

  function walk(items: SettingDefinitionItem[], label: string): void {
    const rowNames: string[] = [];
    for (const item of items) {
      if ('items' in item) {
        const nested = castTo<SettingDefinitionGroup>(item);
        walk(castTo<SettingDefinitionItem[]>(nested.items ?? []), nested.heading ?? castTo<SettingDefinitionPage>(item).name);
      } else {
        rowNames.push(castTo<SettingDefinition>(item).name);
      }
    }

    if (rowNames.length > 0) {
      containers.set(label, rowNames);
    }
  }

  walk(tab.getSettingDefinitions(), TOP_LEVEL_LABEL);
  return containers;
}

/**
 * Maps each page to the subheadings it holds — empty for a page whose rows sit directly on it.
 *
 * @param tab - The settings tab.
 * @returns The subheadings of each page, keyed by page name.
 */
function collectPageSubheadings(tab: PluginSettingsTab): Record<string, string[]> {
  const subheadings: Record<string, string[]> = {};
  for (const item of tab.getSettingDefinitions()) {
    if (!('items' in item) || castTo<SettingDefinitionGroup>(item).heading !== undefined) {
      continue;
    }

    const page = castTo<SettingDefinitionPage>(item);
    subheadings[page.name] = (page.items ?? [])
      .filter((child) => 'heading' in child)
      .map((child) => castTo<SettingDefinitionGroup>(child).heading ?? '');
  }

  return subheadings;
}

/**
 * Flattens the declared items into the rows they contain, recording the group headings on the way.
 *
 * Recurses through pages (issue #221), whose `items` hold groups or rows of their own — a flat walk over
 * the top level would see nothing but the page entries.
 *
 * @param tab - The settings tab.
 * @param shouldRecordHeadings - Whether to record the headings.
 * @returns The declared rows.
 */
function collectRows(tab: PluginSettingsTab, shouldRecordHeadings = false): SettingDefinition[] {
  const rows: SettingDefinition[] = [];

  function walk(items: SettingDefinitionItem[]): void {
    for (const item of items) {
      if ('items' in item) {
        if (shouldRecordHeadings && 'heading' in item) {
          headings.push(castTo<string>(item.heading));
        }

        walk(castTo<SettingDefinitionItem[]>(item.items ?? []));
      } else {
        rows.push(castTo<SettingDefinition>(item));
      }
    }
  }

  walk(tab.getSettingDefinitions());
  return rows;
}

/**
 * Describes the top level of the tab the way the user first meets it: the inline groups, then the
 * navigable page entries.
 *
 * @param tab - The settings tab.
 * @returns One `group:<heading>` / `page:<name>` entry per top-level item.
 */
function collectTopLevel(tab: PluginSettingsTab): string[] {
  return tab.getSettingDefinitions().map((item) => {
    const heading = castTo<SettingDefinitionGroup>(item).heading;
    return heading === undefined ? `page:${castTo<SettingDefinitionPage>(item).name}` : `group:${heading}`;
  });
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
