import type { App } from 'obsidian';

import type { SplitReorderableSectionsResult } from '../heading-sections.ts';

import { HeadingReorderModel } from '../heading-reorder-model.ts';
import { flattenTreeToOrder } from '../heading-sections.ts';
import { didConfirmReorderModal } from './reorder-modal.ts';

/**
 * Parameters for {@link openReorderHeadingsModal}.
 */
export interface OpenReorderHeadingsModalParams {
  readonly app: App;
  readonly split: SplitReorderableSectionsResult;
}

/**
 * Opens the shared reorder modal over the note's heading tree and resolves the chosen new order (a
 * depth-first permutation of section indices), or `null` when the user cancels.
 *
 * A thin adapter since issue #216: the modal, the arrow buttons and the drag support are shared with the
 * folder reorder, and {@link HeadingReorderModel} is what teaches them about a tree — indentation through
 * each row's depth, and same-parent-only movement through each row's group.
 *
 * @param params - The parameters.
 * @returns The chosen order, or `null` if cancelled.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function openReorderHeadingsModal(params: OpenReorderHeadingsModalParams): Promise<null | number[]> {
  const isConfirmed = await didConfirmReorderModal({
    app: params.app,
    confirmButtonText: 'Reorder',
    description: 'Move each heading (and everything nested under it) up or down among its siblings, then confirm.',
    model: new HeadingReorderModel({ split: params.split }),
    title: 'Reorder headings',
    toggle: null
  });

  return isConfirmed ? flattenTreeToOrder(params.split.roots) : null;
}
/* v8 ignore stop */
