import type {
  App,
  FuzzyMatch,
  TFile
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import { FuzzySuggestModal } from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from './confirm-dialog-modal.ts';

import {
  openConfirmDialogModal,
  openModal
} from '../open-minimizable-modal.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';

interface BuildConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly sourceCount: number;
  readonly target: TFile;
}

interface MergeFilesModalConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly promiseResolve: PromiseResolve<null | TFile>;
  readonly sourceFiles: readonly TFile[];
}

interface SelectTargetFileForMergeFilesParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFiles: readonly TFile[];
}

/* v8 ignore start -- MergeFilesModal is an internal UI class tested through exported functions. */
class MergeFilesModal extends FuzzySuggestModal<TFile> {
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | TFile>;
  private readonly sourceFiles: readonly TFile[];

  public constructor(params: MergeFilesModalConstructorParams) {
    super(params.app);

    this.sourceFiles = params.sourceFiles;
    this.promiseResolve = params.promiseResolve;
    this.pluginSettingsComponent = params.pluginSettingsComponent;

    this.setPlaceholder('Select the file to merge the selected files into...');
  }

  public override getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter(this.isAllowedTargetFile.bind(this));
  }

  public override getItemText(item: TFile): string {
    return item.path;
  }

  public override onChooseItem(item: TFile): void {
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
    if (this.sourceFiles.includes(file)) {
      return false;
    }
    // Which notes a merge may swallow (`Should always merge excluded items`) and which it may be poured
    // Into are separate settings since issue #253; this picker asks only the second.
    if (this.pluginSettingsComponent.settings.shouldOfferExcludedPathsAsMergeDestinations) {
      return true;
    }
    return !this.pluginSettingsComponent.settings.isPathIgnored(file.path);
  }
}
/* v8 ignore stop */

/**
 * Prompts for the target file to merge the selected files into, then (when `Should ask before merging`
 * is on) confirms via a dialog that can send the flow back to the picker ("Change target"). Backs the
 * multi-select "merge these files into one file" feature (issue #92).
 *
 * @param params - The selected source files and the shared app/settings context.
 * @returns A {@link Promise} resolving to the chosen target file, or `null` when cancelled.
 */
export async function selectTargetFileForMergeFiles(params: SelectTargetFileForMergeFilesParams): Promise<null | TFile> {
  for (;;) {
    const targetFile = await new Promise<null | TFile>((promiseResolve) => {
      // The initial picker is opened plainly (no minimize button, issue #125): a target has not been
      // Chosen yet, so minimizing serves no purpose.
      openModal(
        new MergeFilesModal({
          ...params,
          promiseResolve
        })
      );
    });

    /* v8 ignore start -- requires MergeFilesModal / ConfirmDialogModal to resolve with a selection, which is untestable in unit tests. */
    if (!targetFile) {
      return null;
    }
    if (!params.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
      return targetFile;
    }
    const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openConfirmDialogModal(
        new ConfirmDialogModal({
          app: params.app,
          buildContent: (fragment): Promise<void> => buildConfirmContent({ app: params.app, fragment, sourceCount: params.sourceFiles.length, target: targetFile }),
          canReselectTarget: true,
          confirmButtonText: 'Merge',
          promiseResolve,
          title: 'Merge files'
        })
      );
    });
    if (confirmDialogResult.shouldReselectTarget) {
      continue;
    }
    if (!confirmDialogResult.isConfirmed) {
      return null;
    }
    await params.pluginSettingsComponent.editAndSave((settings) => {
      settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskAgain;
    });
    return targetFile;
    /* v8 ignore stop */
  }
}

/* v8 ignore start -- builds the confirmation dialog DOM; exercised via desktop integration tests, not unit tests. */
async function buildConfirmContent(params: BuildConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    sourceCount,
    target
  } = params;
  fragment.appendText(`Are you sure you want to merge the ${String(sourceCount)} selected file(s) into `);
  appendCodeBlock(fragment, 'Target');
  fragment.appendText('? The selected files will be deleted.');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: target.path }));
}
/* v8 ignore stop */
