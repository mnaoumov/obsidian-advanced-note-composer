/**
 * @file
 *
 * The one destination-folder picker every flow reopens from a confirmation dialog's "Change target"
 * action (issues #199 / #205).
 *
 * It was extracted from `move-folder-modal.ts`, which had been the only folder picker that was not tied to
 * a specific operation's own suggester. Five flows needed the same thing — a plain "which folder?" question
 * with the plugin's recent-folder ordering and modal instructions — and the only thing that differs between
 * them is which folders are offered, so that is the single injected {@link SelectFolderParams.isAllowedFolder}
 * callback rather than five near-identical `FuzzySuggestModal` subclasses.
 */

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

/**
 * Parameters for {@link selectFolder}.
 */
export interface SelectFolderParams {
  readonly app: App;

  /**
   * Whether a folder is an allowed destination. The only thing that differs between the flows sharing this
   * picker — a move excludes the source's own subtree and its current parent, a flatten excludes the
   * subtree but keeps the parent (staying put is its default, not a no-op), and a create/merge/split
   * destination merely has to not be ignored.
   *
   * @param folder - The candidate destination folder.
   * @returns Whether the folder is offered.
   */
  isAllowedFolder(this: void, folder: TFolder): boolean;

  /**
   * The suggester's placeholder text, e.g. `Select folder to move into...`. Each flow words it in its own
   * terms, because "target" means a different thing in each.
   */
  readonly placeholder: string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface SelectFolderModalConstructorParams extends SelectFolderParams {
  readonly promiseResolve: PromiseResolve<null | TFolder>;
}

/* v8 ignore start -- SelectFolderModal is an internal UI class tested through the exported function. */
class SelectFolderModal extends FuzzySuggestModal<TFolder> {
  private readonly isAllowedFolder: (this: void, folder: TFolder) => boolean;
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<null | TFolder>;

  public constructor(params: SelectFolderModalConstructorParams) {
    super(params.app);

    this.isAllowedFolder = params.isAllowedFolder;
    this.promiseResolve = params.promiseResolve;

    this.setPlaceholder(params.placeholder);

    const builder = new SuggestModalCommandBuilder();
    builder.build(this, { shouldShowInstructions: params.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter((folder) => this.isAllowedFolder(folder));
  }

  public override getItemText(item: TFolder): string {
    return item.isRoot() ? '/' : item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    return reorderSuggestionsByRecentFolders({
      app: this.app,
      isAllowedFolder: this.isAllowedFolder,
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
 * Asks the user for a destination folder.
 *
 * @param params - The parameters.
 * @returns The chosen folder, or `null` when the picker was dismissed. A `null` from a "Change target"
 * detour means "never mind" — the caller returns to its confirmation dialog with the destination it already
 * had, rather than abandoning the whole operation.
 */
export async function selectFolder(params: SelectFolderParams): Promise<null | TFolder> {
  return await new Promise<null | TFolder>((promiseResolve) => {
    openModal(new SelectFolderModal({ ...params, promiseResolve }));
  });
}
