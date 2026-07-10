import type { PromiseResolve } from 'obsidian-dev-utils/async';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import {
  App,
  Editor,
  Keymap,
  Modal,
  Platform,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { SuggestModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';

import type { Selection } from '../composers/composer-base.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  Item,
  SuggestModalBaseConstructorParams
} from './suggest-modal-base.ts';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { getSelections } from '../composers/split-composer.ts';
import { extractHeading } from '../headings.ts';
import { InsertMode } from '../insert-mode.ts';
import { SplitItemSelector } from '../item-selectors/split-item-selector.ts';
import { openMinimizableModal } from '../open-minimizable-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { SuggestModalBase } from './suggest-modal-base.ts';

interface ConfirmDialogModalResult {
  readonly insertMode: InsertMode;
  readonly isConfirmed: boolean;
  readonly shouldAskBeforeSplitting: boolean;
}

interface PrepareForSplitFileParams {
  readonly app: App;
  readonly editor: Editor;
  readonly heading?: string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly shouldSkipModal?: boolean;
  readonly sourceFile: TFile;
}

interface PrepareForSplitFileResult {
  readonly capturedSelections: Selection[];
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly insertMode: InsertMode;
  readonly isNewTargetFile: boolean;
  readonly selectedText: string;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly targetFile: TFile;
}

interface SplitFileModalConstructorParams extends SuggestModalBaseConstructorParams {
  readonly editor: Editor;
  readonly heading: string;
  readonly promiseResolve: PromiseResolve<null | SplitFileModalResult>;
}

/* v8 ignore stop */

interface SplitFileModalResult {
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly inputValue: string;
  readonly insertMode: InsertMode;
  readonly isMod: boolean;
  readonly item: Item | null;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly shouldTreatTitleAsPath: boolean;
}

/* v8 ignore start -- ConfirmDialogModal is an internal UI class tested through exported functions. */
class ConfirmDialogModal extends Modal {
  private isSelected = false;
  private shouldAskBeforeSplitting = true;

  public constructor(
    app: App,
    private readonly sourceFile: TFile,
    private readonly targetFile: TFile,
    private readonly editor: Editor,
    private readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>
  ) {
    super(app);

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
        shouldAskBeforeSplitting: false
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
      shouldAskBeforeSplitting: this.shouldAskBeforeSplitting
    });
    this.close();
  }

  private async onOpenAsync(): Promise<void> {
    this.setTitle('Split file');

    this.containerEl.addClass('mod-confirmation');
    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    this.setContent(
      await createFragmentAsync(async (f) => {
        f.appendText('Are you sure you want to split ');
        appendCodeBlock(f, 'Source');
        f.appendText(' into ');
        appendCodeBlock(f, 'Target');
        f.appendText('?');
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
        f.createEl('br');
        f.createEl('br');
        f.createEl('h2', { text: 'Source content to split' });
        const selectedText = getSelections(this.editor).map((selection) => this.editor.cm.state.sliceDoc(selection.startOffset, selection.endOffset))
          .join('\n');
        const lines = selectedText.split('\n');
        for (const line of lines) {
          appendCodeBlock(f, line);
          f.createEl('br');
        }
      })
    );

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', {
        cls: 'mod-warning',
        text: 'Split and don\'t ask again'
      }, (button) => {
        button.addEventListener('click', (evt) => {
          this.shouldAskBeforeSplitting = false;
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
              this.shouldAskBeforeSplitting = !evt.target.checked;
            });
          });
        label.appendText('Don\'t ask again');
      });
    }

    buttonContainerEl.createEl('button', {
      cls: 'mod-warning',
      text: 'Split'
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

/* v8 ignore stop */

/* v8 ignore start -- SplitFileModal is an internal UI class tested through exported functions. */
class SplitFileModal extends SuggestModalBase {
  private readonly editor: Editor;
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;
  private readonly heading: string;
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<null | SplitFileModalResult>;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldIncludeFrontmatter: boolean;
  private shouldMergeHeadings: boolean;
  private shouldTreatTitleAsPath: boolean;
  private treatTitleAsPathCheckboxEl?: HTMLInputElement;
  private treatTitleAsPathCheckboxElValue?: boolean;

  public constructor(params: SplitFileModalConstructorParams) {
    super(params);

    this.editor = params.editor;
    this.heading = params.heading;
    this.promiseResolve = params.promiseResolve;

    this.shouldIncludeFrontmatter = this.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = this.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = this.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = this.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = this.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;

    this.allowCreateNewFile = true;
    // The split picker offers the current note so a selection can be extracted to its top/bottom
    // (Enter = bottom, Shift+Enter = top), reusing the same-note-move machinery.
    this.shouldAllowSameFile = true;
    this.shouldShowUnresolved = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.setPlaceholder('Select file to split into...');

    invokeAsyncSafely(() => this.buildInstructions());
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.heading;
    this.updateSuggestions();
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
      shouldIncludeFrontmatter: this.shouldIncludeFrontmatter,
      shouldMergeHeadings: this.shouldMergeHeadings,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath
    });
  }

  private async buildInstructions(): Promise<void> {
    const canIncludeFrontmatter = await this.canIncludeFrontmatter();
    const builder = new SuggestModalCommandBuilder();

    builder.addKeyboardCommand({ key: 'UpDown', purpose: 'to navigate' });
    builder.addKeyboardCommand({ key: 'Enter', purpose: 'to move to bottom' });
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
      purpose: 'to move to top'
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
        this.shouldIncludeFrontmatter = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = canIncludeFrontmatter && this.shouldIncludeFrontmatter;
      },
      purpose: 'Include frontmatter'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldTreatTitleAsPath = value;
        this.treatTitleAsPathCheckboxElValue = value;
      },
      onInit: (checkboxEl) => {
        this.treatTitleAsPathCheckboxEl = checkboxEl;
        this.treatTitleAsPathCheckboxElValue = this.shouldTreatTitleAsPath;
        checkboxEl.checked = this.shouldTreatTitleAsPath;
      },
      purpose: 'Treat title as path'
    });

    builder.addCheckbox({
      key: '3',
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
      key: '4',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowOnlyCurrentFolder = value;
        this.updateSuggestions();
        if (this.treatTitleAsPathCheckboxEl !== undefined && this.treatTitleAsPathCheckboxElValue !== undefined) {
          if (this.shouldAllowOnlyCurrentFolder) {
            this.treatTitleAsPathCheckboxEl.checked = false;
            this.treatTitleAsPathCheckboxEl.disabled = true;
            this.shouldTreatTitleAsPath = false;
          } else {
            this.treatTitleAsPathCheckboxEl.checked = this.treatTitleAsPathCheckboxElValue;
            this.treatTitleAsPathCheckboxEl.disabled = false;
            this.shouldTreatTitleAsPath = this.treatTitleAsPathCheckboxElValue;
          }
        }
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '5',
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
      key: '6',
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
      key: '7',
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

    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  private async canIncludeFrontmatter(): Promise<boolean> {
    const sourceCache = await getCacheSafe(this.app, this.sourceFile);
    if (!sourceCache?.frontmatterPosition) {
      return false;
    }
    const selections = getSelections(this.editor);
    if (!selections[0]) {
      return false;
    }
    if (selections[0].startOffset < sourceCache.frontmatterPosition.end.offset) {
      return false;
    }
    return true;
  }
}

export async function prepareForSplitFile(params: PrepareForSplitFileParams): Promise<null | PrepareForSplitFileResult> {
  // Capture the source selection and its text NOW, before the (minimizable) modal opens, while
  // `params.editor` still shows the source note. If the user navigates that leaf to another note
  // During the modal, the same editor object would then reflect THAT note — so the operation must
  // Use this snapshot, never re-read the live editor.
  const capturedSelections = getSelections(params.editor);
  const selectedText = params.editor.getSelection();

  // Lock the source note for the whole setup flow so it cannot be edited while the
  // (minimizable) split/confirmation modal is open — an external edit would corrupt the pending split.
  // The lock is cancelable: an unlock request aborts this controller, which closes the open modal
  // (so the setup flow cancels) and the `using` locks release on return.
  const abortController = new AbortController();
  using _sourceLock = params.resourceLockComponent.lockForPath(params.sourceFile, { abortController });

  let heading = params.heading;
  if (heading === '') {
    heading = undefined;
  }
  heading ??= extractHeading(params.editor);

  const splitFileModalResult: null | SplitFileModalResult = params.shouldSkipModal
    ? {
      frontmatterMergeStrategy: params.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy,
      inputValue: heading,
      insertMode: InsertMode.Append,
      isMod: false,
      item: null,
      shouldAllowOnlyCurrentFolder: params.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault,
      shouldAllowSplitIntoUnresolvedPath: params.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault,
      shouldFixFootnotes: params.pluginSettingsComponent.settings.shouldFixFootnotesByDefault,
      shouldIncludeFrontmatter: params.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault,
      shouldMergeHeadings: params.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault,
      shouldTreatTitleAsPath: params.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault
    }
    : await new Promise<null | SplitFileModalResult>((promiseResolve) => {
      const modal = new SplitFileModal({
        ...params,
        heading,
        promiseResolve
      });
      openMinimizableModal(modal, abortController);
    });

  if (!splitFileModalResult) {
    return null;
  }

  const selectItemResult = await new SplitItemSelector({
    app: params.app,
    inputValue: splitFileModalResult.inputValue,
    isMod: splitFileModalResult.isMod,
    item: splitFileModalResult.item,
    pluginSettingsComponent: params.pluginSettingsComponent,
    shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
    /* v8 ignore start -- short-circuit branch depends on heading being falsy. */
    shouldTreatTitleAsPath: !heading && splitFileModalResult.shouldTreatTitleAsPath,
    /* v8 ignore stop */
    sourceFile: params.sourceFile
  }).selectItem();

  const prepareForSplitFileResult: PrepareForSplitFileResult = {
    capturedSelections,
    frontmatterMergeStrategy: splitFileModalResult.frontmatterMergeStrategy,
    insertMode: splitFileModalResult.insertMode,
    isNewTargetFile: selectItemResult.isNewTargetFile,
    selectedText,
    shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
    shouldAllowSplitIntoUnresolvedPath: splitFileModalResult.shouldAllowSplitIntoUnresolvedPath,
    shouldFixFootnotes: splitFileModalResult.shouldFixFootnotes,
    shouldIncludeFrontmatter: splitFileModalResult.shouldIncludeFrontmatter,
    shouldMergeHeadings: splitFileModalResult.shouldMergeHeadings,
    targetFile: selectItemResult.targetFile
  };

  if (!params.pluginSettingsComponent.settings.shouldAskBeforeSplitting) {
    return prepareForSplitFileResult;
  }

  // The target note is now known; lock it too while the (minimizable) confirmation dialog is open.
  using _targetLock = params.resourceLockComponent.lockForPath(prepareForSplitFileResult.targetFile, { abortController });

  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
    openMinimizableModal(new ConfirmDialogModal(params.app, params.sourceFile, prepareForSplitFileResult.targetFile, params.editor, promiseResolve), abortController);
  });

  /* v8 ignore start -- requires ConfirmDialogModal to resolve with isConfirmed=true which is untestable in unit tests. */
  if (!confirmDialogResult.isConfirmed) {
    if (prepareForSplitFileResult.isNewTargetFile) {
      await trashSafe(params.app, prepareForSplitFileResult.targetFile);
    }
    return null;
  }
  await params.pluginSettingsComponent.editAndSave((settings) => {
    settings.shouldAskBeforeSplitting = confirmDialogResult.shouldAskBeforeSplitting;
  });

  return prepareForSplitFileResult;
  /* v8 ignore stop */
}
