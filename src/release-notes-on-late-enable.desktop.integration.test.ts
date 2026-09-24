import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

interface ReleaseNotesPluginView {
  readonly pluginSettingsComponent?: ReleaseNotesSettingsCarrier;
}

interface ReleaseNotesSettings {
  releaseNotesShown: readonly string[];
}

interface ReleaseNotesSettingsCarrier {
  readonly editAndSave: (editor: (settings: ReleaseNotesSettings) => void) => Promise<void>;
  readonly settings: ReleaseNotesSettings;
}

const PLUGIN_ID = 'advanced-note-composer';

// Issue #293: with the plugin enabled by on-demand-plugins, the release notes came back on every restart.
// That loader enables the plugin AFTER the workspace layout is ready, so `ReleaseNotesComponent`'s
// layout-ready handler fires one tick after load -- while the settings are still being read from `data.json`.
// It then saw the DEFAULT, empty `releaseNotesShown` and showed every note again. Re-enabling the plugin from
// here is the same shape: the layout is long ready by then.
describe('release notes on a late enable (issue #293)', () => {
  it('shows the notes once and not again on the next late enable', async () => {
    const result = await evalInObsidian({
      async callback({ app, pluginId }) {
        const SETTLE_DELAY_IN_MILLISECONDS = 2000;
        const NOTE_COMPOSER_PLUGIN_ID = 'note-composer';

        // The notes are only ever shown while the core plugin is on (issue #95), so with it off the second
        // half would pass whatever the component did.
        const wasNoteComposerEnabled = !!app.internalPlugins.getEnabledPluginById(NOTE_COMPOSER_PLUGIN_ID);
        if (!wasNoteComposerEnabled) {
          await app.internalPlugins.getPluginById(NOTE_COMPOSER_PLUGIN_ID)?.enable(false);
        }

        try {
          await getSettingsComponent().editAndSave((settings) => {
            settings.releaseNotesShown = [];
          });

          // The first late enable is the positive control: nothing was shown yet, so the notes must appear.
          // Without it, a component that never showed anything would pass the second half.
          const firstTitles = await reEnableAndCollectReleaseNotesTitles();
          const shownAfterFirst = [...getSettingsComponent().settings.releaseNotesShown];

          const secondTitles = await reEnableAndCollectReleaseNotesTitles();
          const shownAfterSecond = [...getSettingsComponent().settings.releaseNotesShown];

          return {
            firstTitles,
            secondTitles,
            shownAfterFirst,
            shownAfterSecond
          };
        } finally {
          if (!wasNoteComposerEnabled) {
            app.internalPlugins.getPluginById(NOTE_COMPOSER_PLUGIN_ID)?.disable(false);
          }
        }

        // `pluginSettingsComponent` is protected on `PluginBase`, so it is reached through a structural view
        // rather than the plugin's own type.
        function getSettingsComponent(): ReleaseNotesSettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as null | ReleaseNotesPluginView;
          const pluginSettingsComponent = plugin?.pluginSettingsComponent;
          if (!pluginSettingsComponent) {
            throw new Error('The plugin settings component was not found.');
          }
          return pluginSettingsComponent;
        }

        async function reEnableAndCollectReleaseNotesTitles(): Promise<string[]> {
          await app.plugins.disablePlugin(pluginId);
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          await app.plugins.enablePlugin(pluginId);
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);

          const titles: string[] = [];
          for (const modalEl of activeDocument.querySelectorAll('.modal-container')) {
            const title = modalEl.querySelector('.modal-title')?.textContent ?? '';
            if (!title.endsWith('release notes')) {
              continue;
            }
            titles.push(title);
            // Only ever dismissed through its own OK button, as `plugin-load-creates-no-leaf` explains:
            // detaching the container would leave Obsidian's modal stack believing it is still open.
            const okButtonEl = modalEl.querySelector('.mod-cta');
            if (okButtonEl instanceof HTMLElement) {
              okButtonEl.click();
            }
          }
          return titles;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect({
      firstTitles: result.firstTitles,
      secondTitles: result.secondTitles,
      shownAfterSecond: result.shownAfterSecond
    }).toEqual({
      firstTitles: ['Advanced Note Composer release notes'],
      secondTitles: [],
      shownAfterSecond: result.shownAfterFirst
    });
    expect(result.shownAfterFirst).not.toEqual([]);
  });
});
