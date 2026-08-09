import type {
  App,
  Hotkey
} from 'obsidian';

import { Notice } from 'obsidian';
import {
  configureCommunityPlugin,
  disableCommunityPlugin,
  enableCommunityPlugin,
  installConfigureEnableCommunityPlugin
} from 'obsidian-dev-utils/obsidian/community-plugins';

const PLUGIN_ID = 'advanced-note-composer';
const TEMPLATER_PLUGIN_ID = 'templater-obsidian';

interface DemoSettingsPatch {
  defaultFrontmatterMergeStrategy?: string;
  frontmatterTitleMode?: string;
  mergeTemplate?: string;
  newFolderContentTemplate?: string;
  shouldAddInvalidTitleToNoteAlias?: boolean;
  shouldAlwaysMergeExcludedItems?: boolean;
  shouldJumpToMovedContentToBottom?: boolean;
  shouldJumpToMovedContentToTop?: boolean;
  shouldKeepHeadingsWhenSplittingContent?: boolean;
  shouldLockAllNotesWhenMarkingSelection?: boolean;
  shouldRunTemplaterOnDestinationFile?: boolean;
  shouldSwapEntireFolderStructureByDefault?: boolean;
  shouldTreatTitleAsPathByDefault?: boolean;
  smartCutAndPasteTemplate?: string;
  smartCutAndPasteToBottomTemplate?: string;
  smartCutAndPasteToTopTemplate?: string;
  splitTemplate?: string;
  textAfterExtractionMode?: string;
}

export async function changeSettingsAndReload(app: App, patch: DemoSettingsPatch): Promise<void> {
  const dataPath = `${app.vault.configDir}/plugins/${PLUGIN_ID}/data.json`;
  const data = JSON.parse(await app.vault.adapter.read(dataPath)) as DemoSettingsPatch;
  Object.assign(data, patch);
  await app.vault.adapter.write(dataPath, `${JSON.stringify(data, null, 2)}\n`);
  window.location.reload();
}

/**
 * Installs and enables Templater, then loads the multi-alias content template and reloads.
 *
 * The demo vault ships only the plugin under test and the helper, so the `Templater` section of
 * `29 Create folder with notes` has nothing to run against until this has been done. Templater is
 * installed through Obsidian's own store path rather than committed to the vault.
 */
export async function setUpTemplaterExample(app: App): Promise<void> {
  new Notice('Installing Templater...');
  await installConfigureEnableCommunityPlugin({ app, pluginId: TEMPLATER_PLUGIN_ID });

  // Deliberately NOT `changeSettingsAndReload`: writing `data.json` behind a loaded plugin's back and
  // Then reloading is a race the plugin wins — it saves its own in-memory settings as it unloads, over
  // The file just written. Disabling first means nothing holds stale settings while the file changes,
  // And enabling again picks them up with no window reload at all.
  await disableCommunityPlugin({ app, pluginId: PLUGIN_ID });
  await configureCommunityPlugin({
    app,
    pluginId: PLUGIN_ID,
    settings: {
      newFolderContentTemplate: [
        '{{file}} !.md',
        '---',
        'aliases: <% JSON.stringify(TOKENS.rawFolderName.split(\' - \')) %>',
        '---',
        '# <% TOKENS.folderName %>'
      ].join('\n'),
      shouldRunTemplaterOnDestinationFile: true
    }
  });
  await enableCommunityPlugin({ app, pluginId: PLUGIN_ID });
  new Notice('Templater is ready — the example template is loaded.');
}

export function bindHotkey(app: App, commandId: string, hotkey: Hotkey): void {
  app.hotkeyManager.setHotkeys(commandId, [hotkey]);
  app.hotkeyManager.save();
  app.hotkeyManager.bake();
  new Notice(`Bound hotkey to: ${commandId}`);
}
