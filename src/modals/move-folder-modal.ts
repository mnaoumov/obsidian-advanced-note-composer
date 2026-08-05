import type {
  App,
  FuzzyMatch,
  TFolder
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import { FuzzySuggestModal } from 'obsidian';
import { SuggestModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { openModal } from '../open-minimizable-modal.ts';
import { reorderSuggestionsByRecentFolders } from '../recent-suggestions.ts';

interface IsAllowedMoveTargetParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
}

interface MoveFolderModalConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly promiseResolve: PromiseResolve<null | TFolder>;
  readonly sourceFolder: TFolder;
}

interface SelectTargetFolderForMoveParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
}

/* v8 ignore start -- MoveFolderModal is an internal UI class tested through exported functions. */
class MoveFolderModal extends FuzzySuggestModal<TFolder> {
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | TFolder>;
  private readonly sourceFolder: TFolder;

  public constructor(params: MoveFolderModalConstructorParams) {
    super(params.app);

    this.promiseResolve = params.promiseResolve;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.sourceFolder = params.sourceFolder;

    this.setPlaceholder('Select folder to move into...');

    const builder = new SuggestModalCommandBuilder();
    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter((targetFolder) =>
      isAllowedMoveTarget({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourceFolder: this.sourceFolder,
        targetFolder
      })
    );
  }

  public override getItemText(item: TFolder): string {
    return item.isRoot() ? '/' : item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    return reorderSuggestionsByRecentFolders({
      app: this.app,
      isAllowedFolder: (targetFolder) =>
        isAllowedMoveTarget({
          app: this.app,
          pluginSettingsComponent: this.pluginSettingsComponent,
          sourceFolder: this.sourceFolder,
          targetFolder
        }),
      query,
      suggestions: super.getSuggestions(query)
    });
  }

  public override onChooseItem(item: TFolder): void {
    this.isSelected = true;
    this.promiseResolve(item);
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: FuzzyMatch<TFolder>, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, $event);
  }
}
/* v8 ignore stop */

/**
 * Whether `targetFolder` is a valid destination for moving `sourceFolder` into it: not the source's
 * current parent (that would be a no-op), not the source itself or one of its descendants (a folder
 * cannot be moved into its own subtree), and not an ignored path.
 */
export function isAllowedMoveTarget(params: IsAllowedMoveTargetParams): boolean {
  const { app, pluginSettingsComponent, sourceFolder, targetFolder } = params;
  if (targetFolder === sourceFolder.parent) {
    return false;
  }
  if (isChildOrSelf({ app, childPathOrFile: targetFolder, parentPathOrFile: sourceFolder })) {
    return false;
  }
  return !pluginSettingsComponent.settings.isPathIgnored(targetFolder.path);
}

export async function selectTargetFolderForMove(params: SelectTargetFolderForMoveParams): Promise<null | TFolder> {
  return new Promise<null | TFolder>((promiseResolve) => {
    const modal = new MoveFolderModal({
      ...params,
      promiseResolve
    });
    openModal(modal);
  });
}
