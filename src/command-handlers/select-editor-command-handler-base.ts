import type {
  App,
  Editor,
  IconName,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../command-menu-placement.ts';
import { CommandCategory } from '../plugin-settings.ts';

interface SelectEditorCommandHandlerBaseConstructorParams {
  readonly app: App;
  readonly icon: IconName;
  readonly id: string;
  readonly name: string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Shared base for every `Select ...` command (issue #266) — the commands that only move the editor's
 * selection and then stop.
 *
 * It owns the two things all eight have in common: the {@link CommandCategory.Select} command-visibility
 * check, and the context-menu placement boilerplate. Subclasses decide availability
 * ({@link canSelect}) and what the command does (`executeEditor`).
 *
 * **`isPathIgnored` is deliberately NOT consulted here, unlike in every `Extract ...` handler.** That
 * setting is the CONTENT filter — what may be merged into, split out of, or written to. A select writes
 * nothing at all, so the only filter that can sensibly hide it is the COMMAND one
 * ({@link isEditorCommandBlocked}). Answering two different questions with one setting is what produced
 * bug #253, and it is not repeated here.
 */
export abstract class SelectEditorCommandHandlerBase extends EditorCommandHandler {
  protected readonly app: App;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: SelectEditorCommandHandlerBaseConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: params.icon,
      id: params.id,
      name: params.name
    });

    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.Select, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }

    return this.canSelect(editor, context);
  }

  /**
   * Checks whether this select command has anything to do in the given editor.
   *
   * Returning `false` keeps the command out of the command palette as well as the menus, which is a real
   * win on a phone: filtering a palette by typing is slow, so a command that cannot act should not be in
   * the list to scroll past.
   *
   * @param editor - The editor instance.
   * @param context - The markdown file context.
   * @returns Whether the command can select something.
   */
  protected abstract canSelect(editor: Editor, context: MarkdownFileInfo): boolean;

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    /*
     * No `!editor.somethingSelected()` gate, unlike `Extract this heading...` (issue #188). That gate
     * answers "which EXTRACT did the user mean" when a selection is already live; re-selecting over an
     * existing selection is precisely what a select command is for, so there is nothing to disambiguate.
     */
    return checkShouldAddCommandToEditorMenu({
      commandId: this.id,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(_view: MarkdownView, mode: string, _source: string): boolean {
    return checkShouldAddCommandToViewportMenu({
      commandId: this.id,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }
}
