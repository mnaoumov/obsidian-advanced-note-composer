import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Modal,
  setIcon
} from 'obsidian';

import type { SplitReorderableSectionsResult } from '../heading-sections.ts';

import {
  didMoveSibling,
  flattenHeadingTree,
  flattenTreeToOrder
} from '../heading-sections.ts';
import { openMinimizableModal } from '../open-minimizable-modal.ts';

/**
 * Parameters for {@link openReorderHeadingsModal}.
 */
export interface OpenReorderHeadingsModalParams {
  readonly app: App;
  readonly split: SplitReorderableSectionsResult;
}

interface ReorderHeadingsModalConstructorParams {
  readonly app: App;
  readonly promiseResolve: PromiseResolve<null | number[]>;
  readonly split: SplitReorderableSectionsResult;
}

const DEPTH_INDENT_IN_PIXELS = 20;

/* v8 ignore start -- ReorderHeadingsModal is an internal UI class tested through the real app (integration). */
class ReorderHeadingsModal extends Modal {
  private isConfirmed = false;
  private listEl: HTMLElement | null = null;
  private readonly promiseResolve: PromiseResolve<null | number[]>;
  private readonly split: SplitReorderableSectionsResult;

  public constructor(params: ReorderHeadingsModalConstructorParams) {
    super(params.app);
    this.split = params.split;
    this.promiseResolve = params.promiseResolve;

    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
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
    this.setTitle('Reorder headings');
    this.contentEl.createEl('p', {
      text: 'Move each heading (and everything nested under it) up or down among its siblings, then confirm.'
    });
    this.listEl = this.contentEl.createDiv('advanced-note-composer-reorder-headings-list');
    this.renderList();

    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');
    buttonContainerEl.createEl('button', { cls: 'mod-cta', text: 'Reorder' }, (button) => {
      button.addEventListener('click', () => {
        this.confirm();
      });
    });
    buttonContainerEl.createEl('button', { cls: 'mod-cancel', text: 'Cancel' }, (button) => {
      button.addEventListener('click', () => {
        this.close();
      });
    });
  }

  private confirm(): void {
    this.isConfirmed = true;
    this.promiseResolve(flattenTreeToOrder(this.split.roots));
    this.close();
  }

  private move(index: number, delta: number): void {
    if (didMoveSibling(this.split.roots, index, delta)) {
      this.renderList();
    }
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }
    const listEl = this.listEl;
    listEl.empty();
    for (const row of flattenHeadingTree(this.split)) {
      const itemEl = listEl.createDiv('advanced-note-composer-reorder-headings-item');
      itemEl.dataset['headingText'] = row.section.headingText;
      itemEl.style.marginInlineStart = `${(row.depth * DEPTH_INDENT_IN_PIXELS).toString()}px`;
      itemEl.createSpan({
        cls: 'advanced-note-composer-reorder-headings-title',
        text: `${'#'.repeat(row.section.level)} ${row.section.headingText}`
      });
      const controlsEl = itemEl.createDiv('advanced-note-composer-reorder-headings-controls');
      controlsEl.createEl('button', { cls: 'advanced-note-composer-reorder-headings-up clickable-icon' }, (button) => {
        setIcon(button, 'lucide-arrow-up');
        button.disabled = !row.canMoveUp;
        button.addEventListener('click', () => {
          this.move(row.index, -1);
        });
      });
      controlsEl.createEl('button', { cls: 'advanced-note-composer-reorder-headings-down clickable-icon' }, (button) => {
        setIcon(button, 'lucide-arrow-down');
        button.disabled = !row.canMoveDown;
        button.addEventListener('click', () => {
          this.move(row.index, 1);
        });
      });
    }
  }
}
/* v8 ignore stop */

/**
 * Opens the reorder-headings modal for the note's heading tree and resolves the chosen new order (a
 * depth-first permutation of section indices), or `null` when the user cancels.
 *
 * Minimizable (issue #201): the modal lists headings by text alone, so checking what actually sits under
 * one before confirming the new order means getting the modal out of the way first.
 *
 * @param params - The parameters.
 * @returns The chosen order, or `null` if cancelled.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function openReorderHeadingsModal(params: OpenReorderHeadingsModalParams): Promise<null | number[]> {
  return await new Promise<null | number[]>((promiseResolve) => {
    openMinimizableModal(new ReorderHeadingsModal({ app: params.app, promiseResolve, split: params.split }));
  });
}
/* v8 ignore stop */
