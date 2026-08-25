import { assertNever } from 'obsidian-dev-utils/type-guards';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { CommandCategory } from './plugin-settings.ts';

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
 * Parameters for {@link checkShouldAddCommandToEditorMenu}.
 */
export interface CheckShouldAddCommandToEditorMenuParams {
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
 * Parameters for {@link checkShouldAddCommandToViewportMenu}.
 */
export interface CheckShouldAddCommandToViewportMenuParams {
  /**
   * The category the asking command belongs to.
   */
  readonly commandCategory: CommandCategory;

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
 * Whether a command's category is placed in the EDITOR context menu — the one a right-click on the text
 * raises (issue #252).
 *
 * Command handlers call this from `shouldAddToEditorMenu`, alongside whatever gate the command itself
 * imposes; placement composes with those gates rather than replacing them.
 *
 * @param params - The parameters.
 * @returns Whether the command belongs in the editor menu.
 */
export function checkShouldAddCommandToEditorMenu(params: CheckShouldAddCommandToEditorMenuParams): boolean {
  const placement = params.pluginSettingsComponent.settings.commandMenuPlacement(params.commandCategory);
  switch (placement) {
    case CommandMenuPlacement.Both:
    case CommandMenuPlacement.EditorMenu: {
      return true;
    }
    case CommandMenuPlacement.Neither:
    case CommandMenuPlacement.ViewportMenu: {
      return false;
    }
    default: {
      assertNever(placement);
    }
  }
}

/**
 * Whether a command's category is placed in the VIEWPORT context menu — the one a right-click on the empty
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

  const placement = params.pluginSettingsComponent.settings.commandMenuPlacement(params.commandCategory);
  switch (placement) {
    case CommandMenuPlacement.Both:
    case CommandMenuPlacement.ViewportMenu: {
      return true;
    }
    case CommandMenuPlacement.EditorMenu:
    case CommandMenuPlacement.Neither: {
      return false;
    }
    default: {
      assertNever(placement);
    }
  }
}
