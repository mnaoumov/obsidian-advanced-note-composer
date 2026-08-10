/**
 * @file
 *
 * Helpers to open an Obsidian {@link Modal}, optionally wrapped so it can be minimized to a floating
 * bar and restored (keeping the app usable while the modal is out of the way).
 *
 * - {@link openConfirmDialogModal} is the ONE way a {@link ConfirmDialogModal} is opened. Every
 *   confirmation dialog is minimizable — inspecting what the operation is about to do before confirming
 *   it is the whole point of the dialog (see issue #201) — so the rule is expressed as an opener that
 *   only accepts a confirmation dialog rather than as a convention each flow has to remember.
 * - {@link openMinimizableModal} wraps any other modal so it can be minimized — used for the
 *   split/extract picker, which is deliberately minimizable so a pending extract can be parked and later
 *   cancelled from the minimized bar (see issue #130), and for the two pre-operation option modals
 *   (`Move marked selection here`'s paste options, `Reorder headings`).
 * - {@link openModal} opens the modal plainly, without a minimize button — used for the other initial
 *   picker modals (merge file/folder, swap file/folder), where a target has not been chosen yet:
 *   minimizing there serves no purpose and risks the user forgetting which note the operation was
 *   triggered on (see issue #125).
 *
 * The wrapper decides more than whether a minimize button is drawn: a wrapped modal also **minimizes**
 * when its dimmed background is clicked, instead of being dismissed by it (see issue #202), while a
 * plainly opened one keeps Obsidian's native close-on-background-click. Cancelling a wrapped modal
 * therefore takes a deliberate `Escape`, the dialog's own Cancel, or the floating bar's ✕.
 */

import type { Modal } from 'obsidian';

import { MinimizableModal } from 'obsidian-dev-utils/obsidian/modals/minimizable-modal';

import type { ConfirmDialogModal } from './modals/confirm-dialog-modal.ts';

/**
 * Opens a confirmation dialog. Always minimizable, by construction: a confirmation asks the user to
 * approve something they may first want to go and look at, so every one of them carries the minimize
 * button (issue #201). Do NOT open a {@link ConfirmDialogModal} through {@link openModal} — the narrow
 * parameter type is what keeps that from happening by accident.
 *
 * @param modal - The confirmation dialog to open.
 * @param abortController - An optional controller that closes the dialog when aborted. Only the flows
 * that hold a lock while their dialog is open need it; the rest confirm before taking any lock.
 */
export function openConfirmDialogModal(modal: ConfirmDialogModal, abortController?: AbortController): void {
  openMinimizableModal(modal, abortController);
}

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
