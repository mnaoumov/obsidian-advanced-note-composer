import type {
  App,
  PluginManifest
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { Plugin } from './plugin.ts';

interface ConsoleDebugComponent {
  consoleDebug: ReturnType<typeof vi.fn>;
}

const mockAddChild = vi.fn(<T>(component: T): T => component);
const mockConsoleDebugComponent: ConsoleDebugComponent = { consoleDebug: vi.fn() };

vi.mock('obsidian-dev-utils/obsidian/active-file-provider', () => ({
  AppActiveFileProvider: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/command-handlers/command-handler-component', () => ({
  CommandHandlerComponent: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/command-registrar', () => ({
  PluginCommandRegistrar: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/components/menu-event-registrar-component', () => ({
  MenuEventRegistrarComponent: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/components/plugin-settings-tab-component', () => ({
  PluginSettingsTabComponent: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/data-handler', () => ({
  PluginDataHandler: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/plugin/plugin', () => {
  class MockPluginBase {
    public app: App;
    public manifest: PluginManifest;
    protected consoleDebugComponent = mockConsoleDebugComponent;

    public constructor(app: App, manifest: PluginManifest) {
      this.app = app;
      this.manifest = manifest;
    }

    public addChild<T>(component: T): T {
      return mockAddChild(component) as T;
    }

    public onload(): Promise<void> {
      return this.onloadImpl();
    }

    protected onloadImpl(): Promise<void> {
      // Overridden by the Plugin subclass under test.
      return noopAsync();
    }
  }

  return { PluginBase: MockPluginBase };
});

vi.mock('obsidian-dev-utils/obsidian/plugin/plugin-event-source', () => ({
  PluginEventSourceImpl: vi.fn()
}));

vi.mock('./command-handlers/extract-after-cursor-editor-command-handler.ts', () => ({
  ExtractAfterCursorEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/extract-before-cursor-editor-command-handler.ts', () => ({
  ExtractBeforeCursorEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/extract-current-selection-editor-command-handler.ts', () => ({
  ExtractCurrentSelectionEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/extract-this-heading-editor-command-handler.ts', () => ({
  ExtractThisHeadingEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/merge-file-command-handler.ts', () => ({
  MergeFileCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/merge-folder-command-handler.ts', () => ({
  MergeFolderCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/split-note-by-headings-content-editor-command-handler.ts', () => ({
  SplitNoteByHeadingsContentEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/split-note-by-headings-editor-command-handler.ts', () => ({
  SplitNoteByHeadingsEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/swap-file-command-handler.ts', () => ({
  SwapFileCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/swap-folder-command-handler.ts', () => ({
  SwapFolderCommandHandler: vi.fn()
}));

vi.mock('./plugin-settings-component.ts', () => {
  class MockPluginSettingsComponent {
    public settings: PluginSettings = strictProxy<PluginSettings>({
      releaseNotesShown: []
    });

    public editAndSave = vi.fn().mockImplementation((callback: (settings: PluginSettings) => void): Promise<void> => {
      callback(this.settings);
      return noopAsync();
    });
  }

  return { PluginSettingsComponent: MockPluginSettingsComponent };
});

vi.mock('./plugin-settings-tab.ts', () => ({
  PluginSettingsTab: vi.fn()
}));

vi.mock('./prism-component.ts', () => ({
  PrismComponent: vi.fn()
}));

vi.mock('./release-notes-component.ts', () => ({
  ReleaseNotesComponent: vi.fn()
}));

function createMockApp(): App {
  return strictProxy<App>({});
}

function createMockManifest(): PluginManifest {
  return strictProxy<PluginManifest>({
    id: 'test-plugin',
    name: 'Test Plugin'
  });
}

function createPlugin(): Plugin {
  return new Plugin(createMockApp(), createMockManifest());
}

describe('Plugin', () => {
  describe('constructor', () => {
    it('should add all expected children', async () => {
      mockAddChild.mockClear();
      await createPlugin().onload();

      const PLUGIN_SETTINGS_COMPONENT_CALL = 1;
      const PLUGIN_SETTINGS_TAB_COMPONENT_CALL = 1;
      const MENU_EVENT_REGISTRAR_CALL = 1;
      const COMMAND_HANDLER_COMPONENT_CALL = 1;
      const PRISM_COMPONENT_CALL = 1;
      const RELEASE_NOTES_COMPONENT_CALL = 1;
      const EXPECTED_ADD_CHILD_CALLS = PLUGIN_SETTINGS_COMPONENT_CALL
        + PLUGIN_SETTINGS_TAB_COMPONENT_CALL
        + MENU_EVENT_REGISTRAR_CALL
        + COMMAND_HANDLER_COMPONENT_CALL
        + PRISM_COMPONENT_CALL
        + RELEASE_NOTES_COMPONENT_CALL;

      expect(mockAddChild).toHaveBeenCalledTimes(EXPECTED_ADD_CHILD_CALLS);
    });
  });
});
