import type {
  App,
  Hotkey
} from 'obsidian';

import { Notice } from 'obsidian';
import {
  enableCommunityPlugin,
  installCommunityPlugin
} from 'obsidian-dev-utils/obsidian/community-plugins';

const PLUGIN_ID = 'advanced-note-composer';

interface DemoSettingsPatch {
  defaultFrontmatterMergeStrategy?: string;
  frontmatterTitleMode?: string;
  mergeTemplate?: string;
  shouldAddInvalidTitleToNoteAlias?: boolean;
  shouldKeepHeadingsWhenSplittingContent?: boolean;
  shouldLockAllNotesWhenMarkingSelection?: boolean;
  shouldSwapEntireFolderStructureByDefault?: boolean;
  shouldTreatTitleAsPathByDefault?: boolean;
  smartCutAndPasteTemplate?: string;
  splitTemplate?: string;
  textAfterExtractionMode?: string;
}

export async function installAndEnable(app: App, pluginId: string): Promise<void> {
  await installCommunityPlugin({ app, pluginId });
  await enableCommunityPlugin({ app, pluginId });
  new Notice(`Installed and enabled: ${pluginId}`);
}

export async function changeSettingsAndReload(app: App, patch: DemoSettingsPatch): Promise<void> {
  const dataPath = `${app.vault.configDir}/plugins/${PLUGIN_ID}/data.json`;
  const data = JSON.parse(await app.vault.adapter.read(dataPath)) as DemoSettingsPatch;
  Object.assign(data, patch);
  await app.vault.adapter.write(dataPath, `${JSON.stringify(data, null, 2)}\n`);
  window.location.reload();
}

export function bindHotkey(app: App, commandId: string, hotkey: Hotkey): void {
  app.hotkeyManager.setHotkeys(commandId, [hotkey]);
  app.hotkeyManager.save();
  app.hotkeyManager.bake();
  new Notice(`Bound hotkey to: ${commandId}`);
}
