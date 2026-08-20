/**
 * @file
 *
 * A progress dialog that blocks the vault for the duration of an operation (issue #247).
 *
 * The plugin's operations rewrite links, file names, folder paths and frontmatter across many notes.
 * A notice reports that while leaving Obsidian clickable, so a user can start a second operation on
 * top of a half-applied first one. This dialog takes that away: it cannot be dismissed, and it stays
 * up until the work is genuinely finished.
 *
 * "Genuinely finished" is the whole point of the request — the reporter's own mock-up closed too
 * early, and they said so. A command returning is NOT the end: renaming a file makes other plugins
 * queue their own link updates, and those run afterwards. {@link flushQueue} is the join point for
 * that, since it resolves once the shared `obsidian-dev-utils` queue has drained.
 *
 * `waitForAllAsyncOperations` looks like the obvious candidate and is not: its tracking is disabled
 * outside tests by design, so in production it would resolve immediately and close the dialog exactly
 * as early as the mock-up did.
 */

import type { PluginNoticeComponentDelayedNotice } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import {
  App,
  ButtonComponent,
  Modal
} from 'obsidian';
import {
  invokeAsyncSafely,
  sleep
} from 'obsidian-dev-utils/async';
import { flushQueue } from 'obsidian-dev-utils/obsidian/queue';

/**
 * How long the dialog may keep the vault blocked while waiting for queued work to drain.
 *
 * A dialog that cannot be dismissed and never closes is worse than the problem it solves, so the wait
 * is bounded. Reaching this means something downstream is stuck, not that the work finished, so it is
 * generous enough that no ordinary operation comes near it.
 */
const MAX_DRAIN_WAIT_IN_MILLISECONDS = 60_000;

/**
 * A handle on a shown progress dialog.
 *
 * Deliberately the delayed-notice handle's own type rather than a look-alike, so a call site shows
 * either without knowing which it got and disposes it in its own `finally` exactly as before.
 */
export type OperationProgressModalHandle = PluginNoticeComponentDelayedNotice;

/**
 * Parameters for {@link showOperationProgressModal}.
 */
export interface ShowOperationProgressModalParams {
  /**
   * Aborts the operation when the user asks to cancel.
   */
  readonly abortController: AbortController;

  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * Builds what the dialog says.
   */
  content(this: void): Promise<DocumentFragment | string>;
}

/**
 * A non-dismissable dialog shown for the duration of an operation.
 */
class OperationProgressModal extends Modal {
  private readonly bodyEl: HTMLElement;
  private isClosable = false;

  public constructor(app: App, private readonly abortController: AbortController) {
    super(app);
    // Built here rather than in `onOpen` so it is never absent: a body that might not exist yet would
    // Need a guard on every write, and that guard would be unreachable in practice.
    this.bodyEl = this.contentEl.createDiv();
  }

  public override close(): void {
    if (!this.isClosable) {
      return;
    }

    super.close();
  }

  /**
   * Lets the dialog be closed, then closes it. Until this is called every other route to closing —
   * `Esc`, the close button, clicking the background — is refused.
   */
  public closeWhenDone(): void {
    this.isClosable = true;
    this.close();
  }

  public override onOpen(): void {
    // Obsidian's own close affordance would be a lie while the operation runs, so it goes away rather
    // Than sitting there refusing to work.
    this.modalEl.querySelector('.modal-close-button')?.remove();
    this.titleEl.setText('Working...');
    this.contentEl.createDiv({ cls: 'advanced-note-composer-operation-progress-bar' }, (bar) => {
      bar.createDiv({ cls: 'advanced-note-composer-operation-progress-bar-fill' });
    });

    // Blocking the vault without offering a way out would be a trap. The notice carries a Cancel
    // Button for the same reason, and this is the dialog's version of it.
    new ButtonComponent(this.contentEl.createDiv({ cls: 'advanced-note-composer-operation-progress-buttons' }))
      .setButtonText('Cancel')
      .onClick(() => {
        this.abortController.abort();
      });
  }

  /**
   * Replaces the dialog's body.
   *
   * @param content - The new content.
   */
  public setBody(content: DocumentFragment | string): void {
    this.bodyEl.empty();
    if (typeof content === 'string') {
      this.bodyEl.setText(content);
      return;
    }

    this.bodyEl.append(content);
  }
}

/**
 * Shows a dialog that blocks the vault until the operation and the work it queued have both finished.
 *
 * Disposing the handle does NOT close the dialog straight away: it waits for the queued work to drain
 * first, which is exactly the "only disappears when all links have fully updated" the request asks
 * for. The wait is bounded, so a stuck queue cannot leave the vault blocked forever.
 *
 * @param params - The parameters.
 * @returns A handle that closes the dialog, once it is safe to, when disposed.
 */
export function showOperationProgressModal(params: ShowOperationProgressModalParams): OperationProgressModalHandle {
  const modal = new OperationProgressModal(params.app, params.abortController);
  modal.open();

  invokeAsyncSafely(async () => {
    modal.setBody(await params.content());
  });

  let isDisposed = false;

  return {
    setContent(content: DocumentFragment | string): void {
      if (isDisposed) {
        return;
      }

      modal.setBody(content);
    },
    [Symbol.dispose](): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;

      modal.setBody('Finishing up...');
      invokeAsyncSafely(async () => {
        try {
          await Promise.race([
            flushQueue(),
            sleep({ milliseconds: MAX_DRAIN_WAIT_IN_MILLISECONDS })
          ]);
        } catch (error) {
          // Reported rather than rethrown: whatever failed in the queue has its own error path, and
          // Turning it into an unhandled async error here would add noise without giving the vault back
          // Any sooner. Giving the vault back is this dialog's only remaining job.
          console.warn('Failed to wait for queued work to drain before closing the progress dialog.', error);
        } finally {
          modal.closeWhenDone();
        }
      });
    }
  };
}
