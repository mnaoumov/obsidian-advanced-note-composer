import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Keymap,
  Modal,
  Platform,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  Item,
  SuggestModalBaseConstructorParams
} from './suggest-modal-base.ts';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { InsertMode } from '../insert-mode.ts';
import { MergeItemSelector } from '../item-selectors/merge-item-selector.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { SuggestModalBase } from './suggest-modal-base.ts';
import { SuggestModalCommandBuilder } from './suggest-modal-command-builder.ts';

interface ConfirmDialogModalConstructorParams {
  readonly app: App;
  readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
}

interface ConfirmDialogModalResult {
  readonly insertMode: InsertMode;
  readonly isConfirmed: boolean;
  readonly shouldAskBeforeMerging: boolean;
}

interface MergeFileModalConstructorParams extends SuggestModalBaseConstructorParams {
  readonly promiseResolve: PromiseResolve<MergeFileModalResult | null>;
}

interface MergeFileModalResult {
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly inputValue: string;
  readonly insertMode: InsertMode;
  readonly isMod: boolean;
  readonly item: Item | null;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldMergeHeadings: boolean;
}

interface PrepareForMergeFileParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFile: TFile;
}

/* v8 ignore stop */

interface PrepareForMergeFileResult {
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly insertMode: InsertMode;
  readonly isNewTargetFile: boolean;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly targetFile: TFile;
}

/* v8 ignore start -- ConfirmDialogModal is an internal UI class tested through exported functions. */
class ConfirmDialogModal extends Modal {
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;
  private shouldAskBeforeMerging = true;

  private readonly sourceFile: TFile;
  private readonly targetFile: TFile;

  public constructor(params: ConfirmDialogModalConstructorParams) {
    super(params.app);

    this.sourceFile = params.sourceFile;
    this.targetFile = params.targetFile;
    this.promiseResolve = params.promiseResolve;

    this.scope.register([], 'Enter', (evt) => {
      this.confirm(evt);
    });

    this.scope.register([], 'Escape', () => {
      this.close();
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve({
        insertMode: InsertMode.Append,
        isConfirmed: false,
        shouldAskBeforeMerging: false
      });
    }
  }

  public override onOpen(): void {
    super.onOpen();
    invokeAsyncSafely(this.onOpenAsync.bind(this));
  }

  private confirm(evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: getInsertModeFromEvent(evt),
      isConfirmed: true,
      shouldAskBeforeMerging: this.shouldAskBeforeMerging
    });
    this.close();
  }

  private async onOpenAsync(): Promise<void> {
    this.setTitle('Merge file');

    this.containerEl.addClass('mod-confirmation');
    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    this.setContent(
      await createFragmentAsync(async (f) => {
        f.appendText('Are you sure you want to merge ');
        appendCodeBlock(f, 'Source');
        f.appendText(' into ');
        appendCodeBlock(f, 'Target');
        f.appendText('? ');
        appendCodeBlock(f, 'Source');
        f.appendText(' will be deleted.');
        f.createEl('br');
        f.createEl('br');
        appendCodeBlock(f, 'Source');
        f.appendText(': ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.sourceFile }));
        f.createEl('br');
        f.createEl('br');
        appendCodeBlock(f, 'Target');
        f.appendText(': ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.targetFile }));
      })
    );

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', {
        cls: 'mod-warning',
        text: 'Merge and don\'t ask again'
      }, (button) => {
        button.addEventListener('click', (evt) => {
          this.shouldAskBeforeMerging = false;
          this.confirm(evt);
        });
      });
    } else {
      buttonContainerEl.createEl('label', { cls: 'mod-checkbox' }, (label) => {
        label
          .createEl('input', {
            attr: { tabindex: -1 },
            type: 'checkbox'
          }, (checkbox) => {
            checkbox.addEventListener('change', (evt) => {
              if (!(evt.target instanceof HTMLInputElement)) {
                return;
              }
              this.shouldAskBeforeMerging = !evt.target.checked;
            });
          });
        label.appendText('Don\'t ask again');
      });
    }

    buttonContainerEl.createEl('button', {
      cls: 'mod-warning',
      text: 'Merge'
    }, (button) => {
      button.addEventListener('click', (evt) => {
        this.confirm(evt);
      });
    });

    buttonContainerEl.createEl('button', {
      cls: 'mod-cancel',
      text: 'Cancel'
    }, (button) => {
      button.addEventListener('click', () => {
        this.close();
      });
    });
  }
}

/* v8 ignore start -- MergeFileModal is an internal UI class tested through exported functions. */
class MergeFileModal extends SuggestModalBase {
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;

  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<MergeFileModalResult | null>;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldMergeHeadings: boolean;

  public constructor(params: MergeFileModalConstructorParams) {
    super(params);

    this.promiseResolve = params.promiseResolve;

    this.shouldFixFootnotes = this.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = this.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = this.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;

    this.emptyStateText = 'No files found.';
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;
    this.setPlaceholder('Select file to merge into...');

    const builder = new SuggestModalCommandBuilder();

    builder.addKeyboardCommand({
      key: 'UpDown',
      purpose: 'to navigate'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      purpose: 'to move to bottom'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Mod'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: 'to create new'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Shift'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: 'to merge at top'
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
      onChange: (value: boolean) => {
        this.shouldFixFootnotes = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldFixFootnotes;
      },
      purpose: 'Fix footnotes'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowOnlyCurrentFolder = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '3',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldMergeHeadings = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldMergeHeadings;
      },
      purpose: 'Merge headings'
    });

    builder.addCheckbox({
      key: '4',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowSplitIntoUnresolvedPath = value;
        this.shouldShowUnresolved = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowSplitIntoUnresolvedPath;
      },
      purpose: 'Allow split into unresolved path'
    });

    builder.addDropDown({
      key: '5',
      modifiers: ['Alt'],
      onChange: (value: string) => {
        this.frontmatterMergeStrategy = value as FrontmatterMergeStrategy;
      },
      onInit: (dropdownComponent) => {
        dropdownComponent.addOptions({
          /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
          [FrontmatterMergeStrategy.MergeAndPreferNewValues]: 'Merge and prefer new values',
          [FrontmatterMergeStrategy.MergeAndPreferOriginalValues]: 'Merge and prefer original values',
          [FrontmatterMergeStrategy.KeepOriginalFrontmatter]: 'Keep original frontmatter',
          [FrontmatterMergeStrategy.ReplaceWithNewFrontmatter]: 'Replace with new frontmatter',
          [FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter]: 'Preserve both original and new frontmatter'
          /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
        });
        dropdownComponent.setValue(this.frontmatterMergeStrategy);
      },
      purpose: 'Frontmatter merge strategy'
    });

    builder.build(this);
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: Item | null, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise<void> return type.
  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.promiseResolve({
      frontmatterMergeStrategy: this.frontmatterMergeStrategy,
      inputValue: this.inputEl.value,
      insertMode: getInsertModeFromEvent(evt),
      isMod: Keymap.isModifier(evt, 'Mod'),
      item,
      shouldAllowOnlyCurrentFolder: this.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: this.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: this.shouldFixFootnotes,
      shouldMergeHeadings: this.shouldMergeHeadings
    });
  }
}

/* v8 ignore stop */

export async function prepareForMergeFile(params: PrepareForMergeFileParams): Promise<null | PrepareForMergeFileResult> {
  const result = await new Promise<MergeFileModalResult | null>((promiseResolve) => {
    const modal = new MergeFileModal({
      ...params,
      promiseResolve
    });
    modal.open();
  });

  if (!result) {
    return null;
  }

  const selectItemResult = await new MergeItemSelector({
    app: params.app,
    inputValue: result.inputValue,
    isMod: result.isMod,
    item: result.item,
    pluginSettingsComponent: params.pluginSettingsComponent,
    sourceFile: params.sourceFile
  }).selectItem();

  let prepareForMergeFileResult: PrepareForMergeFileResult = {
    frontmatterMergeStrategy: result.frontmatterMergeStrategy,
    insertMode: result.insertMode,
    isNewTargetFile: selectItemResult.isNewTargetFile,
    shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
    shouldAllowSplitIntoUnresolvedPath: result.shouldAllowSplitIntoUnresolvedPath,
    shouldFixFootnotes: result.shouldFixFootnotes,
    shouldMergeHeadings: result.shouldMergeHeadings,
    targetFile: selectItemResult.targetFile
  };

  if (!params.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
    return prepareForMergeFileResult;
  }

  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
    new ConfirmDialogModal({
      ...params,
      promiseResolve,
      targetFile: prepareForMergeFileResult.targetFile
    }).open();
  });

  /* v8 ignore start -- requires ConfirmDialogModal to resolve with isConfirmed=true which is untestable in unit tests. */
  if (!confirmDialogResult.isConfirmed) {
    return null;
  }
  await params.pluginSettingsComponent.editAndSave((settings) => {
    settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskBeforeMerging;
  });

  prepareForMergeFileResult = {
    ...prepareForMergeFileResult,
    insertMode: confirmDialogResult.insertMode
  };

  return prepareForMergeFileResult;
  /* v8 ignore stop */
}
