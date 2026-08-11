import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Modal,
  setIcon
} from 'obsidian';

import { openMinimizableModal } from '../open-minimizable-modal.ts';

/**
 * Parameters for {@link openReorderModal}.
 */
export interface DidConfirmReorderModalParams {
  readonly app: App;

  /**
   * The text of the confirm button, e.g. `Reorder`.
   */
  readonly confirmButtonText: string;

  /**
   * The sentence under the title explaining what the rows do.
   */
  readonly description: string;

  /**
   * The thing being reordered. The modal mutates it through {@link ReorderModel} and never keeps a copy, so
   * on confirm the caller simply reads its own model back.
   */
  readonly model: ReorderModel;

  readonly title: string;
  /**
   * An optional checkbox above the list (the reorder commands' `Include files`), or `null` for none.
   */
  readonly toggle: null | ReorderModalToggle;
}

/**
 * One row of the list.
 */
export interface ReorderModalRow {
  readonly canMoveDown: boolean;
  readonly canMoveUp: boolean;

  /**
   * The row's identity in the DOM, written to `data-row-label`. Distinct from
   * {@link ReorderModalRow.label} because the displayed text carries decoration a selector should not have
   * to spell — a heading row shows `## Notes` and identifies as `Notes`.
   */
  readonly dataLabel: string;

  /**
   * How deep to indent the row. `0` for a flat list.
   */
  readonly depth: number;

  /**
   * Which group the row belongs to. A row can only ever be moved among rows sharing this key — for the
   * heading tree that is "same parent", for a folder reorder it is "folders" vs "files".
   */
  readonly groupKey: string;

  /**
   * The row's stable identity, handed back to {@link ReorderModel} to say which row moved.
   */
  readonly id: number;

  /**
   * The number the row WILL get, or `null` for a list that does not number anything. Recomputed on every
   * move, which is what makes the modal the operation's preview.
   */
  readonly indexLabel: null | string;
  readonly label: string;
}

/**
 * The checkbox above the list.
 */
export interface ReorderModalToggle {
  readonly isEnabled: boolean;
  readonly label: string;

  /**
   * Called when the box is ticked or cleared. The modal re-reads the model afterwards, so the handler only
   * has to change what the model contains.
   *
   * @param isEnabled - The new state.
   */
  onChanged(this: void, isEnabled: boolean): void;
}

/**
 * The reorderable thing itself: the modal renders whatever {@link ReorderModel.buildRows} returns and asks
 * this to perform each move, so one modal serves a heading tree and a folder listing without knowing what
 * either is.
 */
export interface ReorderModel {
  /**
   * The rows, in the order they are rendered. Rows of one group are contiguous; beyond that the order is
   * the model's own — depth-first for a heading tree, folders-then-files for a folder listing.
   */
  buildRows(this: void): readonly ReorderModalRow[];

  /**
   * Moves a row one place up or down among its own group.
   *
   * @param params - Which row, and which way.
   * @returns Whether anything actually moved.
   */
  didMove(this: void, params: ReorderModelDidMoveParams): boolean;

  /**
   * Moves a row to a dropped-on position within its own group.
   *
   * @param params - Which row, and where it was dropped.
   * @returns Whether anything actually moved.
   */
  didMoveTo(this: void, params: ReorderModelDidMoveToParams): boolean;

  /**
   * The header to render above a group's first row.
   *
   * @param groupKey - The group being started.
   * @returns The header text, or `null` for a group that needs none — which is every group of a heading
   * tree, where the groups exist only to keep a drag among its siblings.
   */
  getGroupTitle(this: void, groupKey: string): null | string;
}

/**
 * Parameters for {@link ReorderModel.didMove}.
 */
export interface ReorderModelDidMoveParams {
  /**
   * The signed offset: `-1` up, `1` down.
   */
  readonly delta: number;
  readonly id: number;
}

/**
 * Parameters for {@link ReorderModel.didMoveTo}.
 */
export interface ReorderModelDidMoveToParams {
  readonly id: number;

  /**
   * Whether the row was dropped after {@link ReorderModelDidMoveToParams.targetId} rather than before it.
   */
  readonly isAfter: boolean;
  readonly targetId: number;
}

const DEPTH_INDENT_IN_PIXELS = 20;

/**
 * A drop lands after the row it is over once the pointer passes this fraction of the row's height — its
 * midpoint, which is what makes the insertion line follow the pointer rather than snap at the edges.
 */
const DROP_AFTER_HEIGHT_FRACTION = 0.5;

const DRAG_OVER_AFTER_CLASS = 'advanced-note-composer-reorder-drag-over-after';
const DRAG_OVER_BEFORE_CLASS = 'advanced-note-composer-reorder-drag-over-before';

interface ReorderModalConstructorParams {
  readonly app: App;
  readonly openParams: DidConfirmReorderModalParams;
  readonly promiseResolve: PromiseResolve<boolean>;
}
/* v8 ignore stop */

/* v8 ignore start -- ReorderModal is an internal UI class tested through the real app (integration). */
class ReorderModal extends Modal {
  private draggedRowId: null | number = null;
  private isConfirmed = false;
  private listEl: HTMLElement | null = null;
  private readonly params: DidConfirmReorderModalParams;
  private readonly promiseResolve: PromiseResolve<boolean>;

  public constructor(params: ReorderModalConstructorParams) {
    super(params.app);
    this.params = params.openParams;
    this.promiseResolve = params.promiseResolve;

    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isConfirmed) {
      this.promiseResolve(false);
    }
  }

  public override onOpen(): void {
    super.onOpen();
    this.setTitle(this.params.title);
    this.contentEl.createEl('p', { text: this.params.description });

    const toggle = this.params.toggle;
    if (toggle) {
      const toggleEl = this.contentEl.createDiv('advanced-note-composer-reorder-toggle');
      toggleEl.createEl('label', {}, (labelEl) => {
        labelEl.createEl('input', { type: 'checkbox' }, (inputEl) => {
          inputEl.checked = toggle.isEnabled;
          inputEl.addEventListener('change', () => {
            toggle.onChanged(inputEl.checked);
            this.renderList();
          });
        });
        labelEl.appendText(toggle.label);
      });
    }

    this.listEl = this.contentEl.createDiv('advanced-note-composer-reorder-list');
    this.renderList();

    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');
    buttonContainerEl.createEl('button', { cls: 'mod-cta', text: this.params.confirmButtonText }, (button) => {
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

  private checkIsAfter(event: DragEvent, itemEl: HTMLElement): boolean {
    const bounds = itemEl.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height * DROP_AFTER_HEIGHT_FRACTION;
  }

  private clearDropIndicators(): void {
    for (const itemEl of this.listEl?.querySelectorAll(`.${DRAG_OVER_AFTER_CLASS}, .${DRAG_OVER_BEFORE_CLASS}`) ?? []) {
      itemEl.removeClasses([DRAG_OVER_AFTER_CLASS, DRAG_OVER_BEFORE_CLASS]);
    }
  }

  private confirm(): void {
    this.isConfirmed = true;
    this.promiseResolve(true);
    this.close();
  }

  private handleDragOver(event: DragEvent, row: ReorderModalRow, itemEl: HTMLElement): void {
    if (this.draggedRowId === null || !this.isSameGroupAsDragged(row)) {
      return;
    }

    // Only a `preventDefault`ed dragover accepts a drop; leaving it alone is what refuses a row from
    // Another group.
    event.preventDefault();
    this.clearDropIndicators();
    itemEl.addClass(this.checkIsAfter(event, itemEl) ? DRAG_OVER_AFTER_CLASS : DRAG_OVER_BEFORE_CLASS);
  }

  private handleDrop(event: DragEvent, row: ReorderModalRow, itemEl: HTMLElement): void {
    event.preventDefault();
    this.clearDropIndicators();
    const draggedRowId = this.draggedRowId;
    this.draggedRowId = null;
    if (draggedRowId === null || !this.isSameGroupAsDragged(row) || draggedRowId === row.id) {
      return;
    }

    if (this.params.model.didMoveTo({ id: draggedRowId, isAfter: this.checkIsAfter(event, itemEl), targetId: row.id })) {
      this.renderList();
    }
  }

  private isSameGroupAsDragged(row: ReorderModalRow): boolean {
    return this.params.model.buildRows().find((candidate) => candidate.id === this.draggedRowId)?.groupKey === row.groupKey;
  }

  private move(id: number, delta: number): void {
    if (this.params.model.didMove({ delta, id })) {
      this.renderList();
    }
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }
    const listEl = this.listEl;
    listEl.empty();

    let previousGroupKey: null | string = null;
    for (const row of this.params.model.buildRows()) {
      if (row.groupKey !== previousGroupKey) {
        previousGroupKey = row.groupKey;
        const groupTitle = this.params.model.getGroupTitle(row.groupKey);
        if (groupTitle !== null) {
          listEl.createEl('h4', { cls: 'advanced-note-composer-reorder-group-title', text: groupTitle });
        }
      }
      this.renderRow(listEl, row);
    }
  }

  private renderRow(listEl: HTMLElement, row: ReorderModalRow): void {
    const itemEl = listEl.createDiv('advanced-note-composer-reorder-item');
    itemEl.dataset['rowLabel'] = row.dataLabel;
    itemEl.style.marginInlineStart = `${(row.depth * DEPTH_INDENT_IN_PIXELS).toString()}px`;
    itemEl.draggable = true;
    itemEl.addEventListener('dragstart', () => {
      this.draggedRowId = row.id;
    });
    itemEl.addEventListener('dragover', (event) => {
      this.handleDragOver(event, row, itemEl);
    });
    itemEl.addEventListener('drop', (event) => {
      this.handleDrop(event, row, itemEl);
    });
    itemEl.addEventListener('dragend', () => {
      this.draggedRowId = null;
      this.clearDropIndicators();
    });

    itemEl.createSpan({ cls: 'advanced-note-composer-reorder-handle' }, (handleEl) => {
      setIcon(handleEl, 'lucide-grip-vertical');
    });
    if (row.indexLabel !== null) {
      itemEl.createSpan({ cls: 'advanced-note-composer-reorder-index', text: row.indexLabel });
    }
    itemEl.createSpan({ cls: 'advanced-note-composer-reorder-title', text: row.label });

    const controlsEl = itemEl.createDiv('advanced-note-composer-reorder-controls');
    controlsEl.createEl('button', { cls: 'advanced-note-composer-reorder-up clickable-icon' }, (button) => {
      setIcon(button, 'lucide-arrow-up');
      button.disabled = !row.canMoveUp;
      button.addEventListener('click', () => {
        this.move(row.id, -1);
      });
    });
    controlsEl.createEl('button', { cls: 'advanced-note-composer-reorder-down clickable-icon' }, (button) => {
      setIcon(button, 'lucide-arrow-down');
      button.disabled = !row.canMoveDown;
      button.addEventListener('click', () => {
        this.move(row.id, 1);
      });
    });
  }
}

/**
 * Opens the shared reorder modal over a {@link ReorderModel} and resolves whether the user confirmed it.
 *
 * The model is mutated in place as the user moves rows, so a confirmed reorder is read back off the
 * caller's own model rather than returned here — which is what lets one modal serve a heading tree and a
 * folder listing without either shape leaking into it.
 *
 * Rows can be moved with the arrow buttons or by dragging, deliberately BOTH: the arrows are the only path
 * that works by touch and the only one a click-driven integration test can drive, while dragging is what
 * makes a twenty-item list bearable. A drag never crosses a group.
 *
 * Minimizable (issue #201): checking what actually sits in a folder before confirming the new order means
 * getting the modal out of the way first.
 *
 * @param params - The parameters.
 * @returns Whether the user confirmed.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function didConfirmReorderModal(params: DidConfirmReorderModalParams): Promise<boolean> {
  return await new Promise<boolean>((promiseResolve) => {
    openMinimizableModal(new ReorderModal({ app: params.app, openParams: params, promiseResolve }));
  });
}
/* v8 ignore stop */
