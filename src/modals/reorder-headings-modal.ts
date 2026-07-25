import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Modal,
  setIcon
} from 'obsidian';

import type { HeadingSection } from '../heading-sections.ts';

/**
 * Parameters for {@link openReorderHeadingsModal}.
 */
export interface OpenReorderHeadingsModalParams {
  readonly app: App;
  readonly sections: readonly HeadingSection[];
}

interface ReorderHeadingsModalConstructorParams {
  readonly app: App;
  readonly promiseResolve: PromiseResolve<null | number[]>;
  readonly sections: readonly HeadingSection[];
}

/* v8 ignore start -- ReorderHeadingsModal is an internal UI class tested through the real app (integration). */
class ReorderHeadingsModal extends Modal {
  private isConfirmed = false;
  private listEl: HTMLElement | null = null;
  private readonly order: number[];
  private readonly promiseResolve: PromiseResolve<null | number[]>;
  private readonly sections: readonly HeadingSection[];

  public constructor(params: ReorderHeadingsModalConstructorParams) {
    super(params.app);
    this.sections = params.sections;
    this.promiseResolve = params.promiseResolve;
    this.order = params.sections.map((_section, index) => index);

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
      text: 'Move each heading (and everything under it) up or down, then confirm.'
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
    this.promiseResolve(this.order);
    this.close();
  }

  private move(position: number, delta: number): void {
    const target = position + delta;
    if (target < 0 || target >= this.order.length) {
      return;
    }
    const current = this.order[position];
    const swapped = this.order[target];
    if (current === undefined || swapped === undefined) {
      return;
    }
    this.order[position] = swapped;
    this.order[target] = current;
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }
    const listEl = this.listEl;
    listEl.empty();
    this.order.forEach((sectionIndex, position) => {
      const section = this.sections[sectionIndex];
      if (!section) {
        return;
      }
      const itemEl = listEl.createDiv('advanced-note-composer-reorder-headings-item');
      itemEl.dataset['headingText'] = section.headingText;
      itemEl.createSpan({
        cls: 'advanced-note-composer-reorder-headings-title',
        text: `${'#'.repeat(section.level)} ${section.headingText}`
      });
      const controlsEl = itemEl.createDiv('advanced-note-composer-reorder-headings-controls');
      controlsEl.createEl('button', { cls: 'advanced-note-composer-reorder-headings-up clickable-icon' }, (button) => {
        setIcon(button, 'lucide-arrow-up');
        button.disabled = position === 0;
        button.addEventListener('click', () => {
          this.move(position, -1);
        });
      });
      controlsEl.createEl('button', { cls: 'advanced-note-composer-reorder-headings-down clickable-icon' }, (button) => {
        setIcon(button, 'lucide-arrow-down');
        button.disabled = position === this.order.length - 1;
        button.addEventListener('click', () => {
          this.move(position, 1);
        });
      });
    });
  }
}
/* v8 ignore stop */

/**
 * Opens the reorder-headings modal for the note's top-level sections and resolves the chosen new order
 * (a permutation of section indices), or `null` when the user cancels.
 *
 * @param params - The parameters.
 * @returns The chosen order, or `null` if cancelled.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function openReorderHeadingsModal(params: OpenReorderHeadingsModalParams): Promise<null | number[]> {
  return await new Promise<null | number[]>((promiseResolve) => {
    new ReorderHeadingsModal({ app: params.app, promiseResolve, sections: params.sections }).open();
  });
}
/* v8 ignore stop */
