import type { PromiseResolve } from '@mnaoumov/typescript-lib/async';
import type {
  App,
  FuzzyMatch,
  HeadingCache,
  TFile
} from 'obsidian';

import { ModalCommandBuilder } from '@mnaoumov/obsidian-lib/modals/modal-command-builder';
import { FuzzySuggestModal } from 'obsidian';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { CommandCategory } from '../settings/plugin-settings.ts';

import { InsertMode } from '../composers/insert-mode.ts';
import { reorderSuggestionsByRecentFiles } from '../recency/recent-suggestions.ts';
import { openModal } from '../ui/open-minimizable-modal.ts';

/**
 * The heading chosen in the target note, and which end of its body the content goes to.
 */
export interface HeadingTarget {
  /**
   * The index of the chosen heading in the target note's `headings` cache.
   */
  readonly headingIndex: number;

  /**
   * `Append` = the end of the heading's body, `Prepend` = right under the heading line.
   */
  readonly insertMode: InsertMode;
}

/**
 * The inputs of {@link selectTargetHeading}.
 */
export interface SelectTargetHeadingParams {
  readonly app: App;
  readonly headings: readonly HeadingCache[];
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly targetFile: TFile;
}

/**
 * The inputs of {@link selectTargetNoteForMove}.
 */
export interface SelectTargetNoteForMoveParams {
  readonly app: App;
  readonly commandCategory: CommandCategory;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface HeadingItem {
  readonly heading: string;
  readonly index: number;
  readonly level: number;
}

interface TargetHeadingModalConstructorParams extends SelectTargetHeadingParams {
  readonly promiseResolve: PromiseResolve<HeadingTarget | null>;
}

interface TargetNoteModalConstructorParams extends SelectTargetNoteForMoveParams {
  readonly promiseResolve: PromiseResolve<null | TFile>;
}

/* v8 ignore start -- Modal UI classes; exercised by move-selection-under-heading.desktop.integration.test.ts. */
/**
 * The heading picker. `Enter` puts the content at the end of the heading's body, `Shift+Enter` right under
 * the heading line, the same two keys the split picker uses for the bottom and the top of a note. The
 * `Insert at top` checkbox does what `Shift` does, for a touch screen.
 */
class TargetHeadingModal extends FuzzySuggestModal<HeadingItem> {
  private readonly headings: readonly HeadingCache[];
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<HeadingTarget | null>;
  private shouldInsertAtTop = false;

  public constructor(params: TargetHeadingModalConstructorParams) {
    super(params.app);
    this.headings = params.headings;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.promiseResolve = params.promiseResolve;
    this.setPlaceholder(`Select the heading in ${params.targetFile.basename} to move the selection under...`);
  }

  public override getItems(): HeadingItem[] {
    return this.headings.map((heading, index) => ({ heading: heading.heading, index, level: heading.level }));
  }

  public override getItemText(item: HeadingItem): string {
    return `${'#'.repeat(item.level)} ${item.heading}`;
  }

  public override onChooseItem(item: HeadingItem, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    this.promiseResolve({
      headingIndex: item.index,
      insertMode: this.shouldInsertAtTop || $event.shiftKey ? InsertMode.Prepend : InsertMode.Append
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override onOpen(): void {
    super.onOpen();
    const builder = new ModalCommandBuilder();
    builder.addKeyboardCommand({ key: 'UpDown', purpose: 'to navigate' });
    builder.addKeyboardCommand({ key: 'Enter', purpose: 'to move to the end of the heading' });
    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Shift'],
      onKey: ($event) => {
        this.selectActiveSuggestion($event);
        return false;
      },
      purpose: 'to move right under the heading'
    });
    builder.addKeyboardCommand({
      key: 'Escape',
      onKey: () => {
        this.close();
        return false;
      },
      purpose: 'to dismiss'
    });
    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldInsertAtTop = isChecked;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldInsertAtTop;
      },
      purpose: 'Insert at top'
    });
    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override selectSuggestion(value: FuzzyMatch<HeadingItem>, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, $event);
  }
}

/**
 * The note picker. A lightweight one rather than the split picker: that one carries a `Create` / `Merge`
 * switch, name rules and option checkboxes for creating a note, none of which a move under an existing
 * heading has any use for. The note the selection is in is offered too, so content can move under another
 * heading of the same note.
 */
class TargetNoteModal extends FuzzySuggestModal<TFile> {
  private readonly commandCategory: CommandCategory;
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | TFile>;

  public constructor(params: TargetNoteModalConstructorParams) {
    super(params.app);
    this.commandCategory = params.commandCategory;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.promiseResolve = params.promiseResolve;
    this.setPlaceholder('Select the note to move the selection into...');
  }

  public override getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((file) => this.isAllowedTargetFile(file));
  }

  public override getItemText(item: TFile): string {
    return item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFile>[] {
    return reorderSuggestionsByRecentFiles({
      app: this.app,
      isAllowedFile: (file) => this.isAllowedTargetFile(file),
      pickerRecencyOrder: this.pluginSettingsComponent.settings.pickerRecencyOrder,
      query,
      suggestions: super.getSuggestions(query)
    });
  }

  public override onChooseItem(item: TFile): void {
    this.isSelected = true;
    this.promiseResolve(item);
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: FuzzyMatch<TFile>, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, $event);
  }

  private isAllowedTargetFile(file: TFile): boolean {
    return !this.pluginSettingsComponent.settings.isPathIgnored(file.path, this.commandCategory);
  }
}

/**
 * Asks for the heading of the target note to move the content under.
 *
 * @param params - The parameters.
 * @returns The chosen heading and insert end, or `null` when the picker was dismissed.
 */
export async function selectTargetHeading(params: SelectTargetHeadingParams): Promise<HeadingTarget | null> {
  return await new Promise<HeadingTarget | null>((promiseResolve) => {
    openModal(new TargetHeadingModal({ ...params, promiseResolve }));
  });
}

/**
 * Asks for the note to move the content into.
 *
 * @param params - The parameters.
 * @returns The chosen note, or `null` when the picker was dismissed.
 */
export async function selectTargetNoteForMove(params: SelectTargetNoteForMoveParams): Promise<null | TFile> {
  return await new Promise<null | TFile>((promiseResolve) => {
    openModal(new TargetNoteModal({ ...params, promiseResolve }));
  });
}
/* v8 ignore stop */
