import type {
  App,
  PluginManifest
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { alert } from 'obsidian-dev-utils/obsidian/modals/alert';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { Plugin } from './plugin.ts';

interface ConsoleDebugComponent {
  debug: ReturnType<typeof vi.fn>;
}

interface PluginInternals extends Plugin {
  onLayoutReady(): Promise<void>;
}

interface PluginSettingsComponentLike {
  editAndSave: ReturnType<typeof vi.fn>;
  settings: PluginSettingsLike;
}

interface PluginSettingsLike {
  releaseNotesShown: string[];
}

const mockAddChild = vi.fn(<T>(component: T): T => component);
const mockConsoleDebugComponent: ConsoleDebugComponent = { debug: vi.fn() };

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

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

vi.mock('obsidian-dev-utils/obsidian/modals/alert', () => ({
  alert: vi.fn().mockResolvedValue(undefined)
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
      return mockAddChild(component);
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
    public editAndSave = vi.fn().mockResolvedValue(undefined);
    public settings: PluginSettingsLike = {
      releaseNotesShown: []
    };
  }

  return { PluginSettingsComponent: MockPluginSettingsComponent };
});

vi.mock('./plugin-settings-tab.ts', () => ({
  PluginSettingsTab: vi.fn()
}));

vi.mock('./prism-component.ts', () => ({
  PrismComponent: vi.fn()
}));

const mockAlert = vi.mocked(alert);

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

function getPluginSettingsComponent(plugin: Plugin): PluginSettingsComponentLike {
  return plugin.pluginSettingsComponent as never;
}

describe('Plugin', () => {
  describe('constructor', () => {
    it('should create pluginSettingsComponent as a child', () => {
      const plugin = createPlugin();

      expect(plugin.pluginSettingsComponent).toBeDefined();
      expect(mockAddChild).toHaveBeenCalled();
    });

    it('should add all expected children', () => {
      mockAddChild.mockClear();
      createPlugin();

      const PLUGIN_SETTINGS_COMPONENT_CALL = 1;
      const PLUGIN_SETTINGS_TAB_COMPONENT_CALL = 1;
      const MENU_EVENT_REGISTRAR_CALL = 1;
      const COMMAND_HANDLER_COMPONENT_CALL = 1;
      const PRISM_COMPONENT_CALL = 1;
      const EXPECTED_ADD_CHILD_CALLS = PLUGIN_SETTINGS_COMPONENT_CALL
        + PLUGIN_SETTINGS_TAB_COMPONENT_CALL
        + MENU_EVENT_REGISTRAR_CALL
        + COMMAND_HANDLER_COMPONENT_CALL
        + PRISM_COMPONENT_CALL;

      expect(mockAddChild).toHaveBeenCalledTimes(EXPECTED_ADD_CHILD_CALLS);
    });
  });

  describe('consoleDebug', () => {
    it('should delegate to consoleDebugComponent.debug', () => {
      const plugin = createPlugin();

      plugin.consoleDebug('test message', 'arg1', 'arg2');

      expect(mockConsoleDebugComponent.debug).toHaveBeenCalledWith('test message', 'arg1', 'arg2');
    });

    it('should pass message without extra args', () => {
      mockConsoleDebugComponent.debug.mockClear();
      const plugin = createPlugin();

      plugin.consoleDebug('simple message');

      expect(mockConsoleDebugComponent.debug).toHaveBeenCalledWith('simple message');
    });
  });

  describe('onLayoutReady', () => {
    it('should show release notes when there are versions not yet shown', async () => {
      const plugin = createPlugin();
      const pluginSettingsComponent = getPluginSettingsComponent(plugin);
      pluginSettingsComponent.settings.releaseNotesShown = [];
      pluginSettingsComponent.editAndSave = vi.fn().mockResolvedValue(undefined);

      await (plugin as PluginInternals).onLayoutReady();

      expect(pluginSettingsComponent.editAndSave).toHaveBeenCalledOnce();
      expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Release notes'
      }));
    });

    it('should skip release notes when all versions are already shown', async () => {
      mockAlert.mockClear();

      const plugin = createPlugin();
      const pluginSettingsComponent = getPluginSettingsComponent(plugin);
      pluginSettingsComponent.settings.releaseNotesShown = ['3.0.0'];
      pluginSettingsComponent.editAndSave = vi.fn().mockResolvedValue(undefined);

      await (plugin as PluginInternals).onLayoutReady();

      expect(pluginSettingsComponent.editAndSave).not.toHaveBeenCalled();
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('should save shown versions to settings', async () => {
      const plugin = createPlugin();
      const pluginSettingsComponent = getPluginSettingsComponent(plugin);
      pluginSettingsComponent.settings.releaseNotesShown = [];
      pluginSettingsComponent.editAndSave = vi.fn().mockImplementation((callback: (settings: PluginSettingsLike) => void) => {
        callback(pluginSettingsComponent.settings);
        return noopAsync();
      });

      await (plugin as PluginInternals).onLayoutReady();

      expect(pluginSettingsComponent.settings.releaseNotesShown).toContain('3.0.0');
    });
  });
});
