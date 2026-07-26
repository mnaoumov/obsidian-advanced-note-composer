import type {
  MarkdownFileInfo,
  TAbstractFile
} from 'obsidian';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

/**
 * Whether an editor command must be blocked (hidden) on the active note's path because command-blocking
 * is on and the path is excluded/ignored in the settings (issue #93). Editor command handlers call this
 * from `canExecuteEditor` so the command disappears from the command palette and the editor menu on an
 * excluded note. A missing `ctx.file` is never blocked.
 *
 * @param pluginSettingsComponent - The plugin settings component.
 * @param ctx - The editor's markdown file context.
 * @returns Whether the command must be blocked.
 */
export function isEditorCommandBlocked(pluginSettingsComponent: PluginSettingsComponent, ctx: MarkdownFileInfo): boolean {
  const file = ctx.file;
  return !!file && pluginSettingsComponent.settings.shouldBlockCommandOnPath(file.path);
}

/**
 * Whether a file/folder command must be blocked (hidden) on the given file's or folder's path because
 * command-blocking is on and the path is excluded/ignored in the settings (issue #93). File and folder
 * command handlers call this from `canExecuteFile` / `canExecuteFolder`.
 *
 * @param pluginSettingsComponent - The plugin settings component.
 * @param abstractFile - The file or folder the command targets.
 * @returns Whether the command must be blocked.
 */
export function isFileOrFolderCommandBlocked(pluginSettingsComponent: PluginSettingsComponent, abstractFile: TAbstractFile): boolean {
  return pluginSettingsComponent.settings.shouldBlockCommandOnPath(abstractFile.path);
}
