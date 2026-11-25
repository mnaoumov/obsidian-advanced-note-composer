import type { PromiseResolve } from '@mnaoumov/typescript-lib/async';

import {
  Modal,
  Setting
} from 'obsidian';

import type { SelectBulkRenameRequestParams } from './bulk-rename-command-handler.ts';
import type {
  BulkRenamePlan,
  BulkRenameRequest
} from './bulk-rename-plan.ts';

import { toEnumValue } from '../settings/enum-value.ts';
import { openMinimizableModal } from '../ui/open-minimizable-modal.ts';
import {
  BulkRenameCaseChange,
  DEFAULT_BULK_RENAME_REQUEST
} from './bulk-rename-plan.ts';

interface AddTextRowParams {
  readonly description: string;
  readonly key: 'findText' | 'prefix' | 'replaceText' | 'suffix';
  readonly name: string;
  readonly placeholder: string;
}

interface BulkRenameModalConstructorParams extends SelectBulkRenameRequestParams {
  readonly promiseResolve: PromiseResolve<BulkRenameRequest | null>;
}

/* v8 ignore start -- BulkRenameModal is an internal UI class tested through the real app (integration). */
class BulkRenameModal extends Modal {
  private readonly buildPlan: (this: void, options: BulkRenameRequest) => BulkRenamePlan;
  private isConfirmed = false;
  private options: BulkRenameRequest = DEFAULT_BULK_RENAME_REQUEST;
  private plan: BulkRenamePlan;
  private readonly previewEl = createDiv('advanced-note-composer-bulk-rename-preview');
  private readonly promiseResolve: PromiseResolve<BulkRenameRequest | null>;
  private readonly renameButtonEl = createEl('button', { cls: 'mod-cta', text: 'Rename' });
  private readonly summaryEl = createDiv('advanced-note-composer-bulk-rename-summary');

  public constructor(params: BulkRenameModalConstructorParams) {
    super(params.app);
    this.buildPlan = params.buildPlan;
    this.promiseResolve = params.promiseResolve;
    this.plan = this.buildPlan(this.options);

    // `Enter` confirms from any field. No `Escape` registration: Obsidian's own `Modal` closes on it, and what
    // cancelling has to get right lives in `onClose`.
    this.scope.register([], 'Enter', () => {
      this.confirm();
      return false;
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isConfirmed) {
      this.promiseResolve(null);
    }
  }

  public override onOpen(): void {
    super.onOpen();
    this.modalEl.addClass('advanced-note-composer-bulk-rename-modal');
    this.setTitle(`Bulk rename ${this.plan.entries.length.toString()} items`);

    this.addTextRow({
      description: 'Text to find. Leave empty to rename by the other fields only.',
      key: 'findText',
      name: 'Find',
      placeholder: 'Text to find'
    });
    this.addTextRow({
      description: 'With a regular expression, $1 names its first group.',
      key: 'replaceText',
      name: 'Replace with',
      placeholder: 'Replacement, $1 = first group'
    });

    // Both switches share one row under `Replace with`, since they qualify the find and replace above them.
    // As two settings rows they took two full rows on a phone (discussion #316).
    const flagsSetting = new Setting(this.contentEl).setClass('advanced-note-composer-bulk-rename-flags');
    this.addFlag(flagsSetting.controlEl, 'Use regular expression', 'isRegularExpression');
    this.addFlag(flagsSetting.controlEl, 'Match case', 'isCaseSensitive');

    new Setting(this.contentEl)
      .setName('Change case')
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
          [BulkRenameCaseChange.Unchanged]: 'Keep as is',
          [BulkRenameCaseChange.Lower]: 'lower case',
          [BulkRenameCaseChange.Upper]: 'UPPER CASE',
          [BulkRenameCaseChange.Title]: 'Title Case',
          [BulkRenameCaseChange.Sentence]: 'Sentence case'
          /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
        });
        dropdown.setValue(this.options.caseChange).onChange((value) => {
          this.update({ caseChange: toEnumValue(BulkRenameCaseChange, value) });
        });
      });

    this.addTextRow({
      description: 'Added before the name. {{index}} numbers the items, {{index:00}} pads the number.',
      key: 'prefix',
      name: 'Prefix',
      placeholder: 'e.g. {{index:00}}. '
    });
    this.addTextRow({
      description: 'Added after the name, before the extension. Takes the same tokens.',
      key: 'suffix',
      name: 'Suffix',
      placeholder: 'e.g. ({{index}})'
    });

    const startNumberDescription = 'The number {{index}} gives the first item.';
    new Setting(this.contentEl)
      .setName('Start number')
      .setDesc(startNumberDescription)
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.title = startNumberDescription;
        text.setValue(this.options.startIndex.toString()).onChange((value) => {
          const startIndex = Number.parseInt(value, 10);
          this.update({ startIndex: Number.isNaN(startIndex) ? DEFAULT_BULK_RENAME_REQUEST.startIndex : startIndex });
        });
      });

    this.contentEl.append(this.summaryEl, this.previewEl);

    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');
    buttonContainerEl.append(this.renameButtonEl);
    this.renameButtonEl.addEventListener('click', () => {
      this.confirm();
    });
    buttonContainerEl.createEl('button', { cls: 'mod-cancel', text: 'Cancel' }, (button) => {
      button.addEventListener('click', () => {
        this.close();
      });
    });

    this.renderPreview();
  }

  private addFlag(containerEl: HTMLElement, text: string, key: 'isCaseSensitive' | 'isRegularExpression'): void {
    containerEl.createEl('label', { cls: 'advanced-note-composer-bulk-rename-flag' }, (labelEl) => {
      const checkboxEl = labelEl.createEl('input', { type: 'checkbox' });
      checkboxEl.dataset['bulkRenameFlag'] = key;
      checkboxEl.checked = this.options[key];
      checkboxEl.addEventListener('change', () => {
        this.update({ [key]: checkboxEl.checked });
      });
      labelEl.appendText(text);
    });
  }

  // The description doubles as the field's tooltip, and a short hint goes in the placeholder: the phone layout
  // hides the descriptions, which took two lines per row there (discussion #316).
  private addTextRow(params: AddTextRowParams): void {
    new Setting(this.contentEl)
      .setName(params.name)
      .setDesc(params.description)
      .addText((text) => {
        const key = params.key;
        text.inputEl.dataset['bulkRenameField'] = key;
        text.inputEl.title = params.description;
        text.setPlaceholder(params.placeholder);
        text.setValue(this.options[key]).onChange((value) => {
          this.update({ [key]: value });
        });
      });
  }

  private canConfirm(): boolean {
    return this.plan.error === null && this.plan.problemCount === 0 && this.plan.changedCount > 0;
  }

  private confirm(): void {
    if (!this.canConfirm()) {
      return;
    }
    this.isConfirmed = true;
    this.promiseResolve(this.options);
    this.close();
  }

  private renderPreview(): void {
    this.previewEl.empty();
    this.summaryEl.empty();
    this.summaryEl.removeClass('mod-warning');

    if (this.plan.error !== null) {
      this.summaryEl.addClass('mod-warning');
      this.summaryEl.setText(this.plan.error);
    } else if (this.plan.problemCount > 0) {
      this.summaryEl.addClass('mod-warning');
      this.summaryEl.setText(`${this.plan.problemCount.toString()} item(s) cannot be renamed. Fix the highlighted names to continue.`);
    } else {
      this.summaryEl.setText(`${this.plan.changedCount.toString()} of ${this.plan.entries.length.toString()} item(s) will be renamed.`);
    }

    for (const entry of this.plan.entries) {
      const rowEl = this.previewEl.createDiv('advanced-note-composer-bulk-rename-row');
      rowEl.dataset['oldPath'] = entry.oldPath;
      rowEl.createSpan({ cls: 'advanced-note-composer-bulk-rename-old', text: entry.oldName });
      rowEl.createSpan({ cls: 'advanced-note-composer-bulk-rename-arrow', text: '→' });
      const newEl = rowEl.createSpan({ cls: 'advanced-note-composer-bulk-rename-new', text: entry.newName });
      if (!entry.isChanged) {
        rowEl.addClass('is-unchanged');
      }
      if (entry.problem === null) {
        continue;
      }

      rowEl.addClass('mod-warning');
      newEl.title = entry.problem;
      rowEl.createDiv({ cls: 'advanced-note-composer-bulk-rename-problem', text: entry.problem });
    }

    this.renameButtonEl.disabled = !this.canConfirm();
  }

  private update(change: Partial<BulkRenameRequest>): void {
    this.options = { ...this.options, ...change };
    this.plan = this.buildPlan(this.options);
    this.renderPreview();
  }
}
/* v8 ignore stop */

/**
 * Opens the bulk rename dialog and resolves the options the user confirmed, or `null` when they cancelled.
 *
 * Minimizable, like the other dialogs that are the last step before an operation runs, so the vault can be
 * looked at before pressing `Rename`.
 *
 * @param params - The app and the planner the preview runs through.
 * @returns The options, or `null` if cancelled.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function selectBulkRenameRequest(params: SelectBulkRenameRequestParams): Promise<BulkRenameRequest | null> {
  return await new Promise<BulkRenameRequest | null>((promiseResolve) => {
    openMinimizableModal(new BulkRenameModal({ ...params, promiseResolve }));
  });
}
/* v8 ignore stop */
