import type {
  MarkdownFileInfo,
  TAbstractFile
} from 'obsidian';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

/**
 * Whether an editor command must be blocked (hidden) on the active note's path because that path is
 * covered by the command-visibility filter (issue #93; its own `Command include/exclude paths` lists since
 * issue #198, rather than `Exclude paths` plus a toggle). Editor command handlers call this from
 * `canExecuteEditor` so the command disappears from the command palette and the editor menu on such a
 * note. A missing `context.file` is never blocked.
 *
 * @param pluginSettingsComponent - The plugin settings component.
 * @param context - The editor's markdown file context.
 * @returns Whether the command must be blocked.
 */
export function isEditorCommandBlocked(pluginSettingsComponent: PluginSettingsComponent, context: MarkdownFileInfo): boolean {
  const file = context.file;
  return !!file && pluginSettingsComponent.settings.shouldBlockCommandOnPath(file.path);
}

/**
 * Whether a file/folder command must be blocked (hidden) on the given file's or folder's path because
 * that path is covered by the command-visibility filter (issue #93 / issue #198). File and folder command
 * handlers call this from `canExecuteFile` / `canExecuteFolder`.
 *
 * @param pluginSettingsComponent - The plugin settings component.
 * @param abstractFile - The file or folder the command targets.
 * @returns Whether the command must be blocked.
 */
export function isFileOrFolderCommandBlocked(pluginSettingsComponent: PluginSettingsComponent, abstractFile: TAbstractFile): boolean {
  return pluginSettingsComponent.settings.shouldBlockCommandOnPath(abstractFile.path);
}
