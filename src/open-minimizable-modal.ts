/**
 * @file
 *
 * Opens an Obsidian {@link Modal} wrapped so it can be minimized to a floating bar and restored,
 * keeping the app usable while the modal is out of the way. Used for the plugin's suggestion and
 * confirmation dialogs so the user can minimize them to inspect the involved notes, then restore.
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
  if (abortController) {
    abortController.signal.addEventListener('abort', () => {
      modal.close();
    }, { once: true });
  }
  new MinimizableModal(modal).modal.open();
}
