import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { CommandMenuPlacement } from './plugin-settings.ts';

/**
 * The `mode` `obsidian-dev-utils` forwards from Obsidian's `markdown-viewport-menu` event for a note being
 * EDITED, as opposed to `'preview'` for one being read.
 *
 * Kept here rather than at each call site so no command handler has to know the literal, and so the one
 * place that compares against it is the one place a future Obsidian rename would have to change.
 */
const SOURCE_VIEW_MODE = 'source';

/**
 * One of the two context menus a command's placement can include (issue #254).
 *
 * The axis the settings UI turns into a toggle each, and what makes {@link CommandMenuPlacement}'s four
 * members two independent yes/no answers rather than four places.
 */
export enum MenuKind {
  /**
   * The menu a right-click on the text raises.
   */
  EditorMenu = 'EditorMenu',

  /**
   * The menu a right-click on the readable-line-length margin or the line-number gutter raises.
   */
  ViewportMenu = 'ViewportMenu'
}

/**
 * Parameters for {@link checkShouldAddCommandToEditorMenu}.
 */
export interface CheckShouldAddCommandToEditorMenuParams {
  /**
   * The id of the asking command, without the plugin-id prefix — the key its placement is stored under.
   */
  readonly commandId: string;

  /**
   * The plugin settings component.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link checkShouldAddCommandToViewportMenu}.
 */
export interface CheckShouldAddCommandToViewportMenuParams {
  /**
   * The id of the asking command, without the plugin-id prefix — the key its placement is stored under.
   */
  readonly commandId: string;

  /**
   * The view mode the menu was raised in, as forwarded from Obsidian's `markdown-viewport-menu` event —
   * `'source'` or `'preview'`.
   */
  readonly mode: string;

  /**
   * The plugin settings component.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Whether a command is placed in the EDITOR context menu — the one a right-click on the text
 * raises (issue #252).
 *
 * Command handlers call this from `shouldAddToEditorMenu`, alongside whatever gate the command itself
 * imposes; placement composes with those gates rather than replacing them.
 *
 * @param params - The parameters.
 * @returns Whether the command belongs in the editor menu.
 */
export function checkShouldAddCommandToEditorMenu(params: CheckShouldAddCommandToEditorMenuParams): boolean {
  return isMenuIncludedInPlacement(params.pluginSettingsComponent.settings.commandMenuPlacement(params.commandId), MenuKind.EditorMenu);
}

/**
 * Whether a command is placed in the VIEWPORT context menu — the one a right-click on the empty
 * margin beside the text, or on the line-number gutter, raises (issue #252).
 *
 * Reading mode is excluded deliberately (owner, 2026-08-23): Obsidian fires the same event over a note
 * being read, but every command this governs edits the note, and the request was about the editing
 * experience. The gutter is NOT excluded — Obsidian raises the one menu for margin and gutter alike, and
 * offering the commands on both is what was asked for.
 *
 * @param params - The parameters.
 * @returns Whether the command belongs in the viewport menu.
 */
export function checkShouldAddCommandToViewportMenu(params: CheckShouldAddCommandToViewportMenuParams): boolean {
  if (params.mode !== SOURCE_VIEW_MODE) {
    return false;
  }

  return isMenuIncludedInPlacement(params.pluginSettingsComponent.settings.commandMenuPlacement(params.commandId), MenuKind.ViewportMenu);
}

/**
 * Whether a placement includes one of the two menus.
 *
 * @param commandMenuPlacement - The placement.
 * @param menuKind - The menu asked about.
 * @returns Whether that menu offers the command.
 */
export function isMenuIncludedInPlacement(commandMenuPlacement: CommandMenuPlacement, menuKind: MenuKind): boolean {
  if (commandMenuPlacement === CommandMenuPlacement.Both) {
    return true;
  }
  if (commandMenuPlacement === CommandMenuPlacement.Neither) {
    return false;
  }
  return commandMenuPlacement === (menuKind === MenuKind.EditorMenu ? CommandMenuPlacement.EditorMenu : CommandMenuPlacement.ViewportMenu);
}

/**
 * The placement that results from flipping one of the two menus on or off.
 *
 * The inverse of {@link isMenuIncludedInPlacement}, and the reason the stored value can stay the enum it
 * has always been while the UI is two toggles: the pair of booleans and the four members are the same
 * thing, so nothing about `data.json` had to change for issue #254.
 *
 * @param commandMenuPlacement - The placement before the flip.
 * @param menuKind - The menu being flipped.
 * @param isIncluded - Whether that menu should offer the command.
 * @returns The resulting placement.
 */
export function withMenuIncludedInPlacement(
  commandMenuPlacement: CommandMenuPlacement,
  menuKind: MenuKind,
  isIncluded: boolean
): CommandMenuPlacement {
  const isEditorMenuIncluded = menuKind === MenuKind.EditorMenu ? isIncluded : isMenuIncludedInPlacement(commandMenuPlacement, MenuKind.EditorMenu);
  const isViewportMenuIncluded = menuKind === MenuKind.ViewportMenu ? isIncluded : isMenuIncludedInPlacement(commandMenuPlacement, MenuKind.ViewportMenu);

  if (isEditorMenuIncluded && isViewportMenuIncluded) {
    return CommandMenuPlacement.Both;
  }
  if (isEditorMenuIncluded) {
    return CommandMenuPlacement.EditorMenu;
  }
  if (isViewportMenuIncluded) {
    return CommandMenuPlacement.ViewportMenu;
  }
  return CommandMenuPlacement.Neither;
}
