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
  shouldOpenFirstNoteAfterMergingFolder?: boolean;
  shouldOpenNoteAfterMergingFolderIntoFile?: boolean;
  shouldRunTemplaterOnDestinationFile?: boolean;
  shouldSwapEntireFolderStructureByDefault?: boolean;
  shouldTreatTitleAsPathByDefault?: boolean;
  smartCutAndPasteTemplate?: string;
  smartCutAndPasteToBottomTemplate?: string;
  smartCutAndPasteToTopTemplate?: string;
  splitTemplate?: string;
  textAfterExtractionMode?: string;
}

/**
 * Applies a settings patch, live.
 *
 * This used to write `data.json` behind the loaded plugin and then reload the window, which was wrong
 * twice over. It was a race the plugin wins — it saves its own in-memory settings as it unloads, over
 * the file just written — which is exactly the reasoning the Templater helper below already spelled
 * out for itself. And the reload took the whole window with it, so a reader lost their place and any
 * automated click-through lost the page it was driving.
 *
 * `configureCommunityPlugin` routes into the plugin's own save path while it is loaded, so the change
 * is live with no reload and no race.
 *
 * Manual equivalent: change the same option in **Settings -> Community plugins -> Advanced Note
 * Composer**.
 */
export async function changeSettings(app: App, patch: DemoSettingsPatch): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: patch });
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

  // Disabled first rather than patched in place: this one replaces a template the plugin reads at
  // Load time, so nothing should hold stale settings while the file changes. Enabling again picks
  // Them up with no window reload at all.
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
