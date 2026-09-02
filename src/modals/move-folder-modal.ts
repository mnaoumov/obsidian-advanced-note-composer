import type {
  App,
  TFolder
} from 'obsidian';

import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { CommandCategory } from '../plugin-settings.ts';
import { selectFolder } from './select-folder-modal.ts';

interface IsAllowedMoveTargetParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
}

interface SelectTargetFolderForMoveParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
}

/**
 * Whether `targetFolder` is a valid destination for moving `sourceFolder` into it: not the source's
 * current parent (that would be a no-op), not the source itself or one of its descendants (a folder
 * cannot be moved into its own subtree), and not an ignored path.
 *
 * The "not the current parent" clause is what a flatten destination deliberately does NOT share — see
 * `isAllowedFlattenDestination`, where the current parent is the default rather than a no-op.
 */
export function isAllowedMoveTarget(params: IsAllowedMoveTargetParams): boolean {
  const { app, pluginSettingsComponent, sourceFolder, targetFolder } = params;
  if (targetFolder === sourceFolder.parent) {
    return false;
  }
  if (isChildOrSelf({ app, childPathOrFile: targetFolder, parentPathOrFile: sourceFolder })) {
    return false;
  }
  return !pluginSettingsComponent.settings.isPathIgnored(targetFolder.path, CommandCategory.MoveAndFlatten);
}

export async function selectTargetFolderForMove(params: SelectTargetFolderForMoveParams): Promise<null | TFolder> {
  const { app, pluginSettingsComponent, sourceFolder } = params;
  return await selectFolder({
    app,
    isAllowedFolder: (targetFolder) => isAllowedMoveTarget({ app, pluginSettingsComponent, sourceFolder, targetFolder }),
    placeholder: 'Select folder to move into...',
    pluginSettingsComponent
  });
}
