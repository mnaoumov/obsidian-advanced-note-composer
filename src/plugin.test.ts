import type {
  App,
  PluginManifest
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import { MenuEventRegistrarComponent } from 'obsidian-dev-utils/obsidian/components/menu-event-registrar-component';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { MoveNoticeComponent } from './move-notice-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { Plugin } from './plugin.ts';
import { PrismComponent } from './prism-component.ts';
import { ReleaseNotesComponent } from './release-notes-component.ts';
import { SelectionHighlightComponent } from './selection-highlight-component.ts';

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

vi.mock('./command-handlers/cancel-move-command-handler.ts', () => ({
  CancelMoveCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/mark-selection-to-move-editor-command-handler.ts', () => ({
  MarkSelectionToMoveEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/merge-file-command-handler.ts', () => ({
  MergeFileCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/merge-folder-command-handler.ts', () => ({
  MergeFolderCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/move-marked-selection-here-editor-command-handler.ts', () => ({
  MoveMarkedSelectionHereEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/move-marked-selection-to-edge-editor-command-handler.ts', () => ({
  MoveMarkedSelectionToEdgeEditorCommandHandler: vi.fn()
}));

vi.mock('./move-notice-component.ts', () => ({
  MoveNoticeComponent: vi.fn()
}));

vi.mock('./selection-highlight-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback -- a non-arrow function so it is constructable via `new`.
  SelectionHighlightComponent: vi.fn(function selectionHighlightComponentStub() {
    return { getEditorExtension: vi.fn().mockReturnValue([]) };
  })
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

vi.mock('obsidian-dev-utils/obsidian/command-handlers/unlock-active-note-command-handler', () => ({
  UnlockActiveNoteCommandHandler: vi.fn()
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
    expect(MoveNoticeComponent).toHaveBeenCalledOnce();
    expect(SelectionHighlightComponent).toHaveBeenCalledOnce();

    const EXPECTED_ADD_CHILD_CALLS = 8;
    expect(addChildSpy).toHaveBeenCalledTimes(EXPECTED_ADD_CHILD_CALLS);
  });

  it('should register an unload cleanup that releases the marked selection', () => {
    const plugin = new Plugin(createMockApp(), createMockManifest());
    const internals = castTo<PluginInternals>(plugin);
    internals._consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
    internals._resourceLockComponent = strictProxy<ResourceLockComponent>({});
    internals._pluginNoticeComponent = strictProxy<PluginNoticeComponent>({});
    const registerSpy = vi.spyOn(plugin, 'register');

    internals.onloadImpl();

    const cleanups = registerSpy.mock.calls.map((call) => call[0]);
    expect(cleanups.length).toBeGreaterThan(0);
    // Invoking the cleanup (as unload would) clears the empty buffer without throwing.
    for (const cleanup of cleanups) {
      expect(() => {
        cleanup();
      }).not.toThrow();
    }
  });
});
