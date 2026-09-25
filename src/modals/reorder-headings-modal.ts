import type { App } from 'obsidian';

import type { HeadingNumbering } from '../heading-numbering.ts';
import type { SplitReorderableSectionsResult } from '../heading-sections.ts';

import { computeHeadingTexts } from '../heading-numbering.ts';
import { HeadingReorderModel } from '../heading-reorder-model.ts';
import { flattenTreeToOrder } from '../heading-sections.ts';
import { didConfirmReorderModal } from './reorder-modal.ts';

/**
 * Parameters for {@link openReorderHeadingsModal}.
 */
export interface OpenReorderHeadingsModalParams {
  readonly app: App;

  /**
   * How the headings are numbered (issue #295). The modal's `Number headings` checkbox flips its
   * `shouldNumber`, and on confirm the resulting texts are written into the split.
   */
  readonly numbering: HeadingNumbering;

  /**
   * Whether to offer the `Number headings` checkbox. Hidden when per-operation overrides are turned off
   * (issue #242), where the settings page is the only place the choice is made.
   */
  readonly shouldShowNumberingToggle: boolean;

  readonly split: SplitReorderableSectionsResult;
}

/**
 * Opens the shared reorder modal over the note's heading tree and resolves the chosen new order (a
 * depth-first permutation of section indices), or `null` when the user cancels. On confirm the split's
 * `headingTexts` hold what every heading will be called, numbered or not.
 *
 * A thin adapter since issue #216: the modal, the arrow buttons and the drag support are shared with the
 * folder reorder, and {@link HeadingReorderModel} is what teaches them about a tree — indentation through
 * each row's depth, moves under a different parent re-leveled to fit, and (issue #295) the numbers each
 * heading will carry, previewed in its row.
 *
 * @param params - The parameters.
 * @returns The chosen order, or `null` if cancelled.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function openReorderHeadingsModal(params: OpenReorderHeadingsModalParams): Promise<null | number[]> {
  const { numbering, split } = params;
  const isConfirmed = await didConfirmReorderModal({
    app: params.app,
    confirmButtonText: 'Reorder',
    description: 'Move each heading (and everything nested under it) up or down, drag it under another heading, or use the left/right arrows to change its level, then confirm.',
    model: new HeadingReorderModel({ numbering, split }),
    title: 'Reorder headings',
    toggle: params.shouldShowNumberingToggle
      ? {
        isEnabled: numbering.shouldNumber,
        label: 'Number headings',
        onChanged: (isEnabled): void => {
          numbering.shouldNumber = isEnabled;
        }
      }
      : null
  });

  if (!isConfirmed) {
    return null;
  }

  split.headingTexts.splice(0, split.headingTexts.length, ...computeHeadingTexts(split, numbering));
  return flattenTreeToOrder(split.roots);
}
/* v8 ignore stop */
