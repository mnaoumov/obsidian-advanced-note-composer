/**
 * @file
 *
 * A delayed progress notice shown while a long-running merge or split operation runs. It describes
 * the operation from the source note to the target note (with clickable links to both). The notice
 * is only shown if the operation is still running after a short delay, so quick operations complete
 * without ever flashing a notice on screen.
 */

import type {
  App,
  Notice,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

/**
 * The default delay before the progress notice is shown. Operations that finish faster than this
 * never show a notice, avoiding a distracting flash for quick splits/merges.
 */
const DEFAULT_DELAY_BEFORE_SHOW_IN_MILLISECONDS = 500;

/**
 * A handle to a scheduled progress notice.
 */
export interface ProgressNoticeHandle {
  /**
   * Cancels the pending notice if it has not been shown yet, or hides it if it is already showing.
   */
  close(): void;
}

/**
 * Parameters for {@link showProgressNotice}.
 */
export interface ShowProgressNoticeParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * How long the operation must run before the progress notice is shown. Operations that finish
   * sooner never show a notice.
   *
   * @default {@link DEFAULT_DELAY_BEFORE_SHOW_IN_MILLISECONDS}
   */
  readonly delayMilliseconds?: number;

  /**
   * The component used to show (and prefix/track) the notice.
   */
  readonly pluginNoticeComponent: PluginNoticeComponent;

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
 * Schedules a progress notice describing the operation from the source note to the target note,
 * with clickable links to both. The notice is only shown once the operation has run for longer than
 * {@link ShowProgressNoticeParams.delayMilliseconds}, so quick operations never flash a notice. The
 * notice stays visible until {@link ProgressNoticeHandle.close} is called.
 *
 * @param params - The parameters.
 * @returns A handle that cancels the pending notice or hides the shown one.
 */
export function showProgressNotice(params: ShowProgressNoticeParams): ProgressNoticeHandle {
  const {
    app,
    delayMilliseconds = DEFAULT_DELAY_BEFORE_SHOW_IN_MILLISECONDS,
    pluginNoticeComponent,
    sourceFile,
    targetFile,
    verb
  } = params;

  let isClosed = false;
  let notice: Notice | null = null;

  const timeoutId = window.setTimeout(() => {
    invokeAsyncSafely(showNoticeAsync);
  }, delayMilliseconds);

  return {
    close(): void {
      isClosed = true;
      window.clearTimeout(timeoutId);
      notice?.hide();
    }
  };

  async function showNoticeAsync(): Promise<void> {
    const fragment = await createFragmentAsync(async (fragmentEl) => {
      fragmentEl.appendText(`${verb} note `);
      fragmentEl.appendChild(await renderInternalLink({ app, pathOrAbstractFile: sourceFile.path }));
      fragmentEl.appendText(' into ');
      fragmentEl.appendChild(await renderInternalLink({ app, pathOrAbstractFile: targetFile.path }));
      fragmentEl.createDiv('is-loading');
    });

    if (isClosed) {
      return;
    }

    notice = pluginNoticeComponent.showNotice(fragment, { isPermanent: true });
  }
}
