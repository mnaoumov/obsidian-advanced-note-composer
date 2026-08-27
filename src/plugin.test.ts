import type {
  App,
  EventRef,
  PluginManifest,
  TFile
} from 'obsidian';
import type { CommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler';
import type { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
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
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { Plugin } from './plugin.ts';
import {
  clearRecentTargets,
  getRecentTargetPaths
} from './recent-targets.ts';
import { ReleaseNotesComponent } from './release-notes-component.ts';
import { SelectionHighlightComponent } from './selection-highlight-component.ts';
import { TokenizedStringLanguageComponent } from './tokenized-string-language-component.ts';

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

vi.mock('./command-handlers/open-split-modal-command-handler.ts', () => ({
  OpenSplitModalCommandHandler: vi.fn()
}));

vi.mock('./move-notice-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback -- a non-arrow function so it is constructable via `new`.
  MoveNoticeComponent: vi.fn(function moveNoticeComponentStub() {
    return { setOpenSplitModalCommandHandler: vi.fn() };
  })
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

vi.mock('./command-handlers/mark-selection-to-swap-editor-command-handler.ts', () => ({
  MarkSelectionToSwapEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/swap-with-marked-selection-editor-command-handler.ts', () => ({
  SwapWithMarkedSelectionEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/flatten-folder-command-handler.ts', () => ({
  FlattenFolderCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/move-folder-command-handler.ts', () => ({
  MoveFolderCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/rename-heading-editor-command-handler.ts', () => ({
  RenameHeadingEditorCommandHandler: vi.fn()
}));

vi.mock('./command-handlers/reorder-headings-editor-command-handler.ts', () => ({
  ReorderHeadingsEditorCommandHandler: vi.fn()
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

vi.mock('./tokenized-string-language-component.ts', () => ({
  TokenizedStringLanguageComponent: vi.fn()
}));

vi.mock('./release-notes-component.ts', () => ({
  ReleaseNotesComponent: vi.fn()
}));

// Since obsidian-dev-utils 93.2.0 the universal components live in a private `components` bag behind
// PROTECTED accessors, not in `_`-prefixed backing fields — assigning the old fields silently registered
// Nothing, and every read of `this.resourceLockComponent` threw `Value is undefined` instead.
interface PluginInternals {
  commandHandlerComponent: CommandHandlerComponent;
  consoleDebugComponent: ConsoleDebugComponent;
  onloadImpl(): Promise<void>;
  pluginNoticeComponent: PluginNoticeComponent;
  pluginSettingsComponent: PluginSettingsComponentBase<object>;
  resourceLockComponent: ResourceLockComponent;
}

function createMockApp(): App {
  return strictProxy<App>({
    // `onloadImpl` subscribes to `file-open` to keep the pickers' recency log current (issue #256). The
    // Ref is a plain object rather than a `strictProxy`: Obsidian reads its internals when the
    // Subscription is released on unload, and a strict mock would throw on the first one.
    workspace: strictProxy({
      offref: vi.fn(),
      on: vi.fn().mockReturnValue(castTo<EventRef>({}))
    })
  });
}

function createMockManifest(): PluginManifest {
  return strictProxy<PluginManifest>({
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0'
  });
}

describe('Plugin', () => {
  it('should wire up all components in onloadImpl', async () => {
    const plugin = new Plugin(createMockApp(), createMockManifest());
    const internals = castTo<PluginInternals>(plugin);
    internals.consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
    internals.resourceLockComponent = strictProxy<ResourceLockComponent>({});
    internals.pluginNoticeComponent = strictProxy<PluginNoticeComponent>({});
    const registerCommandHandlers = vi.fn();
    internals.commandHandlerComponent = strictProxy<CommandHandlerComponent>({ registerCommandHandlers });
    const addChildSpy = vi.spyOn(plugin, 'addChild');

    await internals.onloadImpl();

    expect(PluginSettingsTabComponent).toHaveBeenCalledOnce();
    expect(PluginSettingsTab).toHaveBeenCalledOnce();
    // The plugin's own settings component must REPLACE the placeholder one obsidian-dev-utils 93.2.0
    // Registers, or every dev-utils helper reading `plugin.pluginSettingsComponent` sees empty settings.
    expect(internals.pluginSettingsComponent).toBeInstanceOf(PluginSettingsComponent);
    expect(registerCommandHandlers).toHaveBeenCalledOnce();

    // `registerCommandHandlers` takes a FACTORY, so the handler list is only built when the component
    // Calls it. Build it here, or the array never executes and every handler construction — including the
    // Two spread-generated batches — goes unverified. The handler classes are mocked in this suite, so
    // The assertion is on the shape of the list, not on command identities; those are pinned by each
    // Handler's own suite.
    const buildCommandHandlers = registerCommandHandlers.mock.calls[0]?.[0] as () => CommandHandler[];
    const commandHandlers = buildCommandHandlers();
    // 32 declared directly, plus one per flatten mode (3) and two per heading level (6 x 2).
    const EXPECTED_COMMAND_HANDLER_COUNT = 47;
    expect(commandHandlers).toHaveLength(EXPECTED_COMMAND_HANDLER_COUNT);
    expect(commandHandlers.every(Boolean)).toBe(true);
    expect(TokenizedStringLanguageComponent).toHaveBeenCalledOnce();
    expect(ReleaseNotesComponent).toHaveBeenCalledOnce();
    expect(MoveNoticeComponent).toHaveBeenCalledOnce();
    expect(SelectionHighlightComponent).toHaveBeenCalledOnce();

    const EXPECTED_ADD_CHILD_CALLS = 6;
    expect(addChildSpy).toHaveBeenCalledTimes(EXPECTED_ADD_CHILD_CALLS);
  });

  it('should build fresh command handler instances on every factory call', async () => {
    const plugin = new Plugin(createMockApp(), createMockManifest());
    const internals = castTo<PluginInternals>(plugin);
    internals.consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
    internals.resourceLockComponent = strictProxy<ResourceLockComponent>({});
    internals.pluginNoticeComponent = strictProxy<PluginNoticeComponent>({});
    const registerCommandHandlers = vi.fn();
    internals.commandHandlerComponent = strictProxy<CommandHandlerComponent>({ registerCommandHandlers });

    await internals.onloadImpl();

    // CommandHandlerComponent calls the factory once per menu surface, and since obsidian-dev-utils 90 a
    // Command handler instance cannot be registered twice — so a factory closing over an instance built
    // Outside it throws and the whole plugin fails to load in real Obsidian. Unit tests never caught that
    // While they called the factory only once, which is exactly how it shipped.
    const buildCommandHandlers = registerCommandHandlers.mock.calls[0]?.[0] as () => CommandHandler[];
    const firstBatch = buildCommandHandlers();
    const secondBatch = buildCommandHandlers();

    expect(secondBatch).toHaveLength(firstBatch.length);
    const firstBatchInstances = new Set<CommandHandler>(firstBatch);
    const shared = secondBatch.filter((commandHandler) => firstBatchInstances.has(commandHandler));
    expect(shared).toEqual([]);
  });

  /*
   * Issue #256: opening a note has to demote the folder a previous operation targeted, so the plugin
   * records every `file-open` into the same recency log the pickers read.
   */
  it('should record every opened note into the pickers recency log', async () => {
    const app = createMockApp();
    const plugin = new Plugin(app, createMockManifest());
    const internals = castTo<PluginInternals>(plugin);
    internals.consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
    internals.resourceLockComponent = strictProxy<ResourceLockComponent>({});
    internals.pluginNoticeComponent = strictProxy<PluginNoticeComponent>({});
    internals.commandHandlerComponent = strictProxy<CommandHandlerComponent>({ registerCommandHandlers: vi.fn() });
    clearRecentTargets();

    await internals.onloadImpl();

    // The plugin subscribes to exactly one workspace event, and the assertion names which.
    const [subscription] = vi.mocked(app.workspace.on).mock.calls;
    expect(subscription?.[0]).toBe('file-open');
    const handleFileOpen = castTo<(file: null | TFile) => void>(subscription?.[1]);

    handleFileOpen(castTo<TFile>({ path: 'C/Note C.md' }));
    handleFileOpen(castTo<TFile>({ path: 'D/Note D.md' }));
    // Closing the last note hands over `null`, which records nothing.
    handleFileOpen(null);

    expect(getRecentTargetPaths()).toStrictEqual(['D/Note D.md', 'C/Note C.md']);
    clearRecentTargets();
  });

  it('should register an unload cleanup that releases the marked selection', async () => {
    const plugin = new Plugin(createMockApp(), createMockManifest());
    const internals = castTo<PluginInternals>(plugin);
    internals.consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
    internals.resourceLockComponent = strictProxy<ResourceLockComponent>({});
    internals.pluginNoticeComponent = strictProxy<PluginNoticeComponent>({});
    internals.commandHandlerComponent = strictProxy<CommandHandlerComponent>({ registerCommandHandlers: vi.fn() });
    const registerSpy = vi.spyOn(plugin, 'register');

    await internals.onloadImpl();

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
