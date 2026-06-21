import type { App } from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { appendCodeBlock } from 'obsidian-dev-utils/html-element';
import { alert } from 'obsidian-dev-utils/obsidian/modals/alert';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { ReleaseNotesComponent } from './release-notes-component.ts';

interface MockAppResult {
  readonly app: App;
  triggerLayoutReady(): void;
}

interface MockPluginSettingsComponentResult {
  readonly editAndSave: ReturnType<typeof vi.fn>;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly settings: PluginSettings;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/modals/alert', () => ({
  alert: vi.fn().mockResolvedValue(undefined)
}));

const mockAppendCodeBlock = vi.mocked(appendCodeBlock);
const mockAlert = vi.mocked(alert);

function createMockApp(): MockAppResult {
  let layoutReadyCallback: (() => void) | undefined;

  const app = strictProxy<App>({
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

function createMockPluginSettingsComponent(releaseNotesShown: string[]): MockPluginSettingsComponentResult {
  const settings = strictProxy<PluginSettings>({
    releaseNotesShown
  });

  const editAndSave = vi.fn().mockImplementation((callback: (settings: PluginSettings) => void): Promise<void> => {
    callback(settings);
    return noopAsync();
  });

  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    editAndSave,
    settings
  });

  return {
    editAndSave,
    pluginSettingsComponent,
    settings
  };
}

async function triggerLayoutReadyAndWait(triggerLayoutReady: () => void): Promise<void> {
  // The real `invokeAsyncSafely` (inside `LayoutReadyComponent`) starts `onLayoutReady`
  // Synchronously and fire-and-forgets it. Trigger the layout-ready callback, then flush
  // The pending microtasks so the awaited (mocked) `editAndSave`/`alert` work completes.
  triggerLayoutReady();
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

describe('ReleaseNotesComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('onLayoutReady', () => {
    it('should show release notes, persist shown versions, and render the code block when the version was not shown yet', async () => {
      const { app, triggerLayoutReady } = createMockApp();
      const { editAndSave, pluginSettingsComponent, settings } = createMockPluginSettingsComponent([]);
      const component = new ReleaseNotesComponent({
        app,
        pluginSettingsComponent
      });

      component.load();
      await triggerLayoutReadyAndWait(triggerLayoutReady);

      expect(mockAppendCodeBlock).toHaveBeenCalledWith(expect.anything(), 'Note composer');
      expect(editAndSave).toHaveBeenCalledTimes(1);
      expect(settings.releaseNotesShown).toContain('3.0.0');
      expect(mockAlert).toHaveBeenCalledTimes(1);
      expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Release notes' }));
    });

    it('should do nothing when all release note versions were already shown', async () => {
      const { app, triggerLayoutReady } = createMockApp();
      const { editAndSave, pluginSettingsComponent } = createMockPluginSettingsComponent(['3.0.0']);
      const component = new ReleaseNotesComponent({
        app,
        pluginSettingsComponent
      });

      component.load();
      await triggerLayoutReadyAndWait(triggerLayoutReady);

      expect(editAndSave).not.toHaveBeenCalled();
      expect(mockAlert).not.toHaveBeenCalled();
    });
  });
});
