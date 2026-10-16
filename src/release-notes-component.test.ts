import type { InternalPlugins } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { alert } from '@mnaoumov/obsidian-lib/modals/alert';
import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { createReleaseNotesComponent } from './release-notes-component.ts';

interface MockAppResult {
  readonly app: App;
  readonly triggerLayoutReady: () => void;
}

interface MockPluginSettingsComponentResult {
  readonly editAndSave: ReturnType<typeof vi.fn>;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly settings: PluginSettings;
  readonly whenLoadedFromFile: ReturnType<typeof vi.fn>;
}

// Partial: the library's own release-notes component imports this module too, and needs the rest of it.
vi.mock('@mnaoumov/obsidian-lib/html-element', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/html-element')>(),
  appendCodeBlock: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/modals/alert', () => ({
  alert: vi.fn().mockResolvedValue(undefined)
}));

const mockAppendCodeBlock = vi.mocked(appendCodeBlock);
const mockAlert = vi.mocked(alert);

const PLUGIN_NAME = 'Advanced Note Composer';

function createMockApp(isNoteComposerEnabled = true): MockAppResult {
  let layoutReadyCallback: (() => void) | undefined;

  const app = strictProxy<App>({
    internalPlugins: strictProxy<InternalPlugins>({
      getEnabledPluginById: castTo<InternalPlugins['getEnabledPluginById']>(
        vi.fn((id: string) => (id === 'note-composer' && isNoteComposerEnabled ? strictProxy({}) : null))
      )
    }),
    workspace: {
      onLayoutReady: vi.fn((callback: () => void) => {
        layoutReadyCallback = callback;
      })
    }
  });

  return {
    app,
    triggerLayoutReady: (): void => {
      layoutReadyCallback?.();
    }
  };
}

function createMockPluginSettingsComponent(
  releaseNotesShown: string[],
  loadedFromFilePromise: Promise<void> = noopAsync()
): MockPluginSettingsComponentResult {
  const settings = strictProxy<PluginSettings>({
    releaseNotesShown
  });

  const whenLoadedFromFile = vi.fn((): Promise<void> => loadedFromFilePromise);

  const editAndSave = vi.fn().mockImplementation((callback: (settings: PluginSettings) => void): Promise<void> => {
    callback(settings);
    return noopAsync();
  });

  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    editAndSave,
    settings,
    whenLoadedFromFile
  });

  return {
    editAndSave,
    pluginSettingsComponent,
    settings,
    whenLoadedFromFile
  };
}

async function triggerLayoutReadyAndWait(triggerLayoutReady: () => void): Promise<void> {
  // `LayoutReadyComponent.onload` schedules a `window.setTimeout(0)` that fire-and-forgets
  // `onLayoutReady` via the real `invokeAsyncSafely`. Flush that one-shot timer with fake
  // timers so the tracked async operation is registered, then settle it deterministically
  // via the async-operation-tracking setup file instead of racing a real `setTimeout(0)`.
  vi.useFakeTimers();
  try {
    triggerLayoutReady();
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
  }
  await waitForAllAsyncOperations();
}

describe('createReleaseNotesComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on layout ready', () => {
    it('should show release notes, persist shown versions, and render the code block when the version was not shown yet', async () => {
      const { app, triggerLayoutReady } = createMockApp();
      const { editAndSave, pluginSettingsComponent, settings } = createMockPluginSettingsComponent([]);
      const component = createReleaseNotesComponent({
        app,
        pluginName: PLUGIN_NAME,
        pluginSettingsComponent
      });

      component.load();
      await triggerLayoutReadyAndWait(triggerLayoutReady);

      expect(mockAppendCodeBlock).toHaveBeenCalledWith(expect.anything(), 'Note composer');
      expect(editAndSave).toHaveBeenCalledTimes(1);
      expect(settings.releaseNotesShown).toContain('3.0.0');
      expect(settings.releaseNotesShown).toContain('5.11.0');
      expect(settings.releaseNotesShown).toContain('5.12.0');
      expect(mockAlert).toHaveBeenCalledTimes(1);
      // The library renders the plugin name as code, so the title is a fragment, not a string.
      const title = ensureNonNullable(mockAlert.mock.lastCall)[0].title;
      expect(title).toBeInstanceOf(DocumentFragment);
      const titleFragment = castTo<DocumentFragment>(title);
      expect(titleFragment.textContent).toBe('Advanced Note Composer release notes');
      expect(titleFragment.querySelector('code')?.textContent).toBe(PLUGIN_NAME);
    });

    // Issue #293: a loader such as on-demand-plugins enables the plugin AFTER the layout is ready, so the
    // layout-ready handler fires one tick after load, while `data.json` is still being read. Reading
    // `releaseNotesShown` then answers with the DEFAULT empty list, and the notes reappear on every restart.
    it('should wait for the settings to be loaded from the file before deciding what was already shown', async () => {
      const { app, triggerLayoutReady } = createMockApp();
      let resolveLoadedFromFile: () => void = noop;
      const loadedFromFilePromise = new Promise<void>((resolve) => {
        resolveLoadedFromFile = resolve;
      });
      const { editAndSave, pluginSettingsComponent, settings, whenLoadedFromFile } = createMockPluginSettingsComponent(
        [],
        loadedFromFilePromise
      );
      const component = createReleaseNotesComponent({
        app,
        pluginName: PLUGIN_NAME,
        pluginSettingsComponent
      });

      component.load();
      vi.useFakeTimers();
      try {
        triggerLayoutReady();
        vi.runAllTimers();
      } finally {
        vi.useRealTimers();
      }

      expect(whenLoadedFromFile).toHaveBeenCalledTimes(1);
      settings.releaseNotesShown = ['3.0.0', '5.11.0', '5.12.0'];
      resolveLoadedFromFile();
      await waitForAllAsyncOperations();

      expect(editAndSave).not.toHaveBeenCalled();
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('should keep the versions already shown and append only the ones shown now', async () => {
      const { app, triggerLayoutReady } = createMockApp();
      const { pluginSettingsComponent, settings } = createMockPluginSettingsComponent(['3.0.0']);
      const component = createReleaseNotesComponent({
        app,
        pluginName: PLUGIN_NAME,
        pluginSettingsComponent
      });

      component.load();
      await triggerLayoutReadyAndWait(triggerLayoutReady);

      expect(settings.releaseNotesShown).toEqual(['3.0.0', '5.11.0', '5.12.0']);
      const message = mockAlert.mock.lastCall?.[0].message;
      expect(message).toBeInstanceOf(DocumentFragment);
      expect(Array.from(castTo<DocumentFragment>(message).querySelectorAll('h3'), (heading) => heading.textContent)).toEqual(['5.11.0', '5.12.0']);
    });

    it('should do nothing when all release note versions were already shown', async () => {
      const { app, triggerLayoutReady } = createMockApp();
      const { editAndSave, pluginSettingsComponent } = createMockPluginSettingsComponent(['3.0.0', '5.11.0', '5.12.0']);
      const component = createReleaseNotesComponent({
        app,
        pluginName: PLUGIN_NAME,
        pluginSettingsComponent
      });

      component.load();
      await triggerLayoutReadyAndWait(triggerLayoutReady);

      expect(editAndSave).not.toHaveBeenCalled();
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('should show and persist release notes when the core note-composer plugin is enabled', async () => {
      const { app, triggerLayoutReady } = createMockApp(true);
      const { editAndSave, pluginSettingsComponent, settings } = createMockPluginSettingsComponent([]);
      const component = createReleaseNotesComponent({
        app,
        pluginName: PLUGIN_NAME,
        pluginSettingsComponent
      });

      component.load();
      await triggerLayoutReadyAndWait(triggerLayoutReady);

      expect(editAndSave).toHaveBeenCalledTimes(1);
      expect(settings.releaseNotesShown).toContain('3.0.0');
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });

    it('should not show or persist release notes when the core note-composer plugin is disabled', async () => {
      const { app, triggerLayoutReady } = createMockApp(false);
      const { editAndSave, pluginSettingsComponent, settings } = createMockPluginSettingsComponent([]);
      const component = createReleaseNotesComponent({
        app,
        pluginName: PLUGIN_NAME,
        pluginSettingsComponent
      });

      component.load();
      await triggerLayoutReadyAndWait(triggerLayoutReady);

      expect(editAndSave).not.toHaveBeenCalled();
      expect(settings.releaseNotesShown).not.toContain('3.0.0');
      expect(mockAlert).not.toHaveBeenCalled();
    });
  });
});
