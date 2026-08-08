import type {
  App,
  FuzzyMatch,
  TFolder
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import { FuzzySuggestModal } from 'obsidian';
import { SuggestModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { openModal } from '../open-minimizable-modal.ts';
import { reorderSuggestionsByRecentFolders } from '../recent-suggestions.ts';

interface CreateFolderParentModalConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly promiseResolve: PromiseResolve<null | TFolder>;
}

interface IsAllowedParentFolderParams {
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly targetFolder: TFolder;
}

interface SelectParentFolderForCreateParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/* v8 ignore start -- CreateFolderParentModal is an internal UI class tested through exported functions. */
class CreateFolderParentModal extends FuzzySuggestModal<TFolder> {
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | TFolder>;

  public constructor(params: CreateFolderParentModalConstructorParams) {
    super(params.app);

    this.promiseResolve = params.promiseResolve;
    this.pluginSettingsComponent = params.pluginSettingsComponent;

    this.setPlaceholder('Select folder to create in...');

    const builder = new SuggestModalCommandBuilder();
    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter((targetFolder) =>
      isAllowedParentFolder({
        pluginSettingsComponent: this.pluginSettingsComponent,
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
        isAllowedParentFolder({
          pluginSettingsComponent: this.pluginSettingsComponent,
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
 * Whether a folder can hold a newly created folder. Only the ignored-paths rule applies — unlike the move
 * picker there is no source folder, so none of its "not into itself, not into its current parent"
 * constraints exist. The vault root IS offered, since creating a top-level folder is ordinary.
 *
 * @param params - The candidate folder and the settings.
 * @returns Whether the folder is offered.
 */
export function isAllowedParentFolder(params: IsAllowedParentFolderParams): boolean {
  const { pluginSettingsComponent, targetFolder } = params;
  return !pluginSettingsComponent.settings.isPathIgnored(targetFolder.path);
}

/**
 * Asks which folder the new folder goes into. Only the command palette needs this: invoked from the folder
 * menu, the right-clicked folder already IS the answer.
 *
 * @param params - The app and the settings.
 * @returns The chosen folder, or `null` when the picker was dismissed.
 */
export async function selectParentFolderForCreate(params: SelectParentFolderForCreateParams): Promise<null | TFolder> {
  return new Promise<null | TFolder>((promiseResolve) => {
    const modal = new CreateFolderParentModal({
      ...params,
      promiseResolve
    });
    openModal(modal);
  });
}
