/**
 * @file
 *
 * Helpers to open an Obsidian {@link Modal}, optionally wrapped so it can be minimized to a floating
 * bar and restored (keeping the app usable while the modal is out of the way).
 *
 * - {@link openMinimizableModal} wraps the modal so it can be minimized — used for the confirmation
 *   dialogs (minimizing to inspect the two involved notes before confirming is the point), and for the
 *   split/extract picker, which is deliberately minimizable so a pending extract can be parked and later
 *   cancelled from the minimized bar (see issue #130).
 * - {@link openModal} opens the modal plainly, without a minimize button — used for the other initial
 *   picker modals (merge file/folder, swap file/folder), where a target has not been chosen yet:
 *   minimizing there serves no purpose and risks the user forgetting which note the operation was
 *   triggered on (see issue #125).
 */

import type { Modal } from 'obsidian';

import { MinimizableModal } from 'obsidian-dev-utils/obsidian/modals/minimizable-modal';

/**
 * Wraps the given modal in a {@link MinimizableModal} and opens it.
 *
 * @param modal - The modal to wrap and open.
 * @param abortController - An optional controller that closes the modal when aborted. This lets an
 * external unlock request (the lock indicator's "Unlock" menu or the "Unlock active note" command)
 * cancel the operation while its modal is still open (including while minimized).
 */
export function openMinimizableModal(modal: Modal, abortController?: AbortController): void {
  wireAbortToClose(modal, abortController);
  new MinimizableModal(modal).modal.open();
}

/**
 * Opens the given modal plainly, without wrapping it in a {@link MinimizableModal} (no minimize
 * button).
 *
 * @param modal - The modal to open.
 * @param abortController - An optional controller that closes the modal when aborted. This lets an
 * external unlock request (the lock indicator's "Unlock" menu or the "Unlock active note" command)
 * cancel the operation while its modal is still open.
 */
export function openModal(modal: Modal, abortController?: AbortController): void {
  wireAbortToClose(modal, abortController);
  modal.open();
}

function wireAbortToClose(modal: Modal, abortController?: AbortController): void {
  if (abortController) {
    abortController.signal.addEventListener('abort', () => {
      modal.close();
    }, { once: true });
  }
}
