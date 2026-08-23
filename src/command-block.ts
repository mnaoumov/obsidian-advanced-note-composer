import type {
  MarkdownFileInfo,
  TAbstractFile
} from 'obsidian';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { CommandCategory } from './plugin-settings.ts';

/**
 * Parameters for {@link isEditorCommandBlocked}.
 */
export interface IsEditorCommandBlockedParams {
  /**
   * The category the asking command belongs to.
   */
  readonly commandCategory: CommandCategory;

  /**
   * The editor's markdown file context.
   */
  readonly context: MarkdownFileInfo;

  /**
   * The plugin settings component.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link isFileOrFolderCommandBlocked}.
 */
export interface IsFileOrFolderCommandBlockedParams {
  /**
   * The file or folder the command targets.
   */
  readonly abstractFile: TAbstractFile;

  /**
   * The category the asking command belongs to.
   */
  readonly commandCategory: CommandCategory;

  /**
   * The plugin settings component.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Whether an editor command must be blocked (hidden) on the active note's path because that path is
 * covered by the command-visibility filter (issue #93; its own `Command include/exclude paths` lists since
 * issue #198, rather than `Exclude paths` plus a toggle; narrowed per command category since issue #249).
 * Editor command handlers call this from `canExecuteEditor` so the command disappears from the command
 * palette and the editor menu on such a note. A missing `context.file` is never blocked.
 *
 * @param params - The parameters.
 * @returns Whether the command must be blocked.
 */
export function isEditorCommandBlocked(params: IsEditorCommandBlockedParams): boolean {
  const file = params.context.file;
  return !!file && params.pluginSettingsComponent.settings.shouldBlockCommandOnPath(file.path, params.commandCategory);
}

/**
 * Whether a file/folder command must be blocked (hidden) on the given file's or folder's path because
 * that path is covered by the command-visibility filter (issues #93 / #198 / #249). File and folder
 * command handlers call this from `canExecuteFile` / `canExecuteFolder`.
 *
 * @param params - The parameters.
 * @returns Whether the command must be blocked.
 */
export function isFileOrFolderCommandBlocked(params: IsFileOrFolderCommandBlockedParams): boolean {
  return params.pluginSettingsComponent.settings.shouldBlockCommandOnPath(params.abstractFile.path, params.commandCategory);
}
