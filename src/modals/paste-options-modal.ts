import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Modal,
  Setting
} from 'obsidian';

import { FrontmatterMergeStrategy } from '../plugin-settings.ts';

/**
 * The options that apply to a `Move marked selection here` operation. The target note and insert
 * location (the cursor) are already fixed, so only the content-processing options are configurable.
 */
export interface MoveOptions {
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
}

/**
 * Parameters for {@link openPasteOptionsModal}.
 */
export interface OpenPasteOptionsModalParams {
  readonly app: App;
  readonly defaultOptions: MoveOptions;
}

/* v8 ignore start -- PasteOptionsModal is an internal UI class tested through the real app (integration). */
class PasteOptionsModal extends Modal {
  private isConfirmed = false;
  private options: MoveOptions;

  public constructor(
    app: App,
    defaultOptions: MoveOptions,
    private readonly promiseResolve: PromiseResolve<MoveOptions | null>
  ) {
    super(app);
    this.options = defaultOptions;

    this.scope.register([], 'Enter', () => {
      this.confirm();
    });

    this.scope.register([], 'Escape', () => {
      this.close();
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
    this.setTitle('Move marked selection here');

    new Setting(this.contentEl)
      .setName('Include frontmatter')
      .addToggle((toggle) => {
        toggle.setValue(this.options.shouldIncludeFrontmatter).onChange((value) => {
          this.options = { ...this.options, shouldIncludeFrontmatter: value };
        });
      });

    new Setting(this.contentEl)
      .setName('Fix footnotes')
      .addToggle((toggle) => {
        toggle.setValue(this.options.shouldFixFootnotes).onChange((value) => {
          this.options = { ...this.options, shouldFixFootnotes: value };
        });
      });

    new Setting(this.contentEl)
      .setName('Frontmatter merge strategy')
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
          [FrontmatterMergeStrategy.MergeAndPreferNewValues]: 'Merge and prefer new values',
          [FrontmatterMergeStrategy.MergeAndPreferOriginalValues]: 'Merge and prefer original values',
          [FrontmatterMergeStrategy.KeepOriginalFrontmatter]: 'Keep original frontmatter',
          [FrontmatterMergeStrategy.ReplaceWithNewFrontmatter]: 'Replace with new frontmatter',
          [FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter]: 'Preserve both original and new frontmatter'
          /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
        });
        dropdown.setValue(this.options.frontmatterMergeStrategy).onChange((value) => {
          this.options = { ...this.options, frontmatterMergeStrategy: value as FrontmatterMergeStrategy };
        });
      });

    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    buttonContainerEl.createEl('button', {
      cls: 'mod-cta',
      text: 'Move'
    }, (button) => {
      button.addEventListener('click', () => {
        this.confirm();
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

  private confirm(): void {
    this.isConfirmed = true;
    this.promiseResolve(this.options);
    this.close();
  }
}
/* v8 ignore stop */

/**
 * Opens the advanced-move options modal seeded with the given defaults, and resolves the chosen
 * options, or `null` when the user cancels.
 *
 * @param params - The parameters.
 * @returns The chosen options, or `null` if cancelled.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function openPasteOptionsModal(params: OpenPasteOptionsModalParams): Promise<MoveOptions | null> {
  return await new Promise<MoveOptions | null>((promiseResolve) => {
    new PasteOptionsModal(params.app, params.defaultOptions, promiseResolve).open();
  });
}
/* v8 ignore stop */
