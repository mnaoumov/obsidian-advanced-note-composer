import type {
  App,
  Command,
  PluginManifest,
  TFile,
  Workspace
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import { MenuEventRegistrarComponent } from 'obsidian-dev-utils/obsidian/components/menu-event-registrar-component';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import {
  isResourceLockedForPath,
  requestResourceUnlockForPath
} from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { Plugin } from './plugin.ts';
import { PrismComponent } from './prism-component.ts';
import { ReleaseNotesComponent } from './release-notes-component.ts';

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

vi.mock('obsidian-dev-utils/obsidian/resource-lock', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/resource-lock')>(),
  isResourceLockedForPath: vi.fn(),
  requestResourceUnlockForPath: vi.fn()
}));

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

interface PluginInternals {
  _consoleDebugComponent: ConsoleDebugComponent;
  _pluginNoticeComponent: PluginNoticeComponent;
  _resourceLockComponent: ResourceLockComponent;
  onloadImpl(): void;
}

function createMockApp(): App {
  return strictProxy<App>({});
}

function createMockManifest(): PluginManifest {
  return strictProxy<PluginManifest>({
    id: 'test-plugin',
    name: 'Test Plugin'
  });
}

describe('Plugin', () => {
  it('should wire up all components in onloadImpl', () => {
    const plugin = new Plugin(createMockApp(), createMockManifest());
    const internals = castTo<PluginInternals>(plugin);
    internals._consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
    internals._resourceLockComponent = strictProxy<ResourceLockComponent>({});
    internals._pluginNoticeComponent = strictProxy<PluginNoticeComponent>({});
    const addChildSpy = vi.spyOn(plugin, 'addChild');

    internals.onloadImpl();

    expect(PluginSettingsTabComponent).toHaveBeenCalledOnce();
    expect(PluginSettingsTab).toHaveBeenCalledOnce();
    expect(MenuEventRegistrarComponent).toHaveBeenCalledOnce();
    expect(CommandHandlerComponent).toHaveBeenCalledOnce();
    expect(PrismComponent).toHaveBeenCalledOnce();
    expect(ReleaseNotesComponent).toHaveBeenCalledOnce();

    const EXPECTED_ADD_CHILD_CALLS = 6;
    expect(addChildSpy).toHaveBeenCalledTimes(EXPECTED_ADD_CHILD_CALLS);
  });
});

describe('unlock-active-note command', () => {
  beforeEach(() => {
    vi.mocked(isResourceLockedForPath).mockReset();
    vi.mocked(requestResourceUnlockForPath).mockReset();
  });

  function registerCommand(activeFile: null | TFile): Command {
    const app = strictProxy<App>({
      workspace: strictProxy<Workspace>({
        getActiveFile: vi.fn().mockReturnValue(activeFile)
      })
    });
    const plugin = new Plugin(app, createMockManifest());
    const internals = castTo<PluginInternals>(plugin);
    internals._consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
    internals._resourceLockComponent = strictProxy<ResourceLockComponent>({});
    internals._pluginNoticeComponent = strictProxy<PluginNoticeComponent>({});
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');

    internals.onloadImpl();

    const command = addCommandSpy.mock.calls
      .map((call) => call[0])
      .find((candidate) => candidate.id === 'unlock-active-note');
    if (!command) {
      throw new Error('Command was not registered');
    }
    return command;
  }

  it('should be hidden when there is no active file', () => {
    const command = registerCommand(null);
    expect(command.checkCallback?.(true)).toBe(false);
    expect(requestResourceUnlockForPath).not.toHaveBeenCalled();
  });

  it('should be hidden when the active file is not locked', () => {
    vi.mocked(isResourceLockedForPath).mockReturnValue(false);
    const activeFile = strictProxy<TFile>({ path: 'active.md' });
    const command = registerCommand(activeFile);
    expect(command.checkCallback?.(true)).toBe(false);
    expect(requestResourceUnlockForPath).not.toHaveBeenCalled();
  });

  it('should be available and request an unlock when the active file is locked', () => {
    vi.mocked(isResourceLockedForPath).mockReturnValue(true);
    const activeFile = strictProxy<TFile>({ path: 'active.md' });
    const command = registerCommand(activeFile);

    // While checking, the command is enabled but performs no action.
    expect(command.checkCallback?.(true)).toBe(true);
    expect(requestResourceUnlockForPath).not.toHaveBeenCalled();

    // When executed, it requests the unlock of the active file.
    expect(command.checkCallback?.(false)).toBe(true);
    expect(requestResourceUnlockForPath).toHaveBeenCalledWith(expect.anything(), activeFile);
  });
});
