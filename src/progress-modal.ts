/**
 * @file
 *
 * A minimizable progress modal shown while a long-running merge or split operation runs. It
 * describes the operation from the source note to the target note (with clickable links to both)
 * and can be minimized so the app stays usable while the operation continues in the background.
 */

import type {
  App,
  TFile
} from 'obsidian';

import { Modal } from 'obsidian';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { MinimizableModal } from 'obsidian-dev-utils/obsidian/modals/minimizable-modal';

/**
 * Parameters for {@link openProgressModal}.
 */
export interface OpenProgressModalParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The source note of the operation.
   */
  readonly sourceFile: TFile;

  /**
   * The target note of the operation.
   */
  readonly targetFile: TFile;

  /**
   * The progressive verb describing the operation, e.g. `Splitting` or `Merging`.
   */
  readonly verb: string;
}

/**
 * A handle to an open progress modal.
 */
export interface ProgressModalHandle {
  /**
   * Closes the progress modal.
   */
  close(): void;
}

/**
 * Opens a minimizable progress modal describing the operation from the source note to the target
 * note, with clickable links to both. The modal stays open (and can be minimized to keep the app
 * usable) until {@link ProgressModalHandle.close} is called.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} resolving to a handle that closes the modal.
 */
export async function openProgressModal(params: OpenProgressModalParams): Promise<ProgressModalHandle> {
  const {
    app,
    sourceFile,
    targetFile,
    verb
  } = params;

  const modal = new Modal(app);
  modal.setTitle(`Advanced Note Composer: ${verb} note`);
  modal.contentEl.appendText(`${verb} note `);
  modal.contentEl.appendChild(await renderInternalLink({ app, pathOrAbstractFile: sourceFile.path }));
  modal.contentEl.appendText(' into ');
  modal.contentEl.appendChild(await renderInternalLink({ app, pathOrAbstractFile: targetFile.path }));
  modal.contentEl.createDiv('is-loading');

  const minimizableModal = new MinimizableModal(modal);
  minimizableModal.modal.open();

  return {
    close(): void {
      minimizableModal.modal.close();
    }
  };
}
