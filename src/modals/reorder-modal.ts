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

const DRAG_HANDLE_ICON_ID = 'lucide-grip-vertical';
const DRAG_OVER_AFTER_CLASS = 'advanced-note-composer-reorder-drag-over-after';
const DRAG_OVER_BEFORE_CLASS = 'advanced-note-composer-reorder-drag-over-before';

/**
 * The `Draggable.type` our rows advertise to Obsidian's drag manager. Every other drag in the app — a
 * file from the explorer, a link from an editor — carries a different type, so this string is the whole
 * of the "is this one of ours?" test.
 */
const REORDER_DRAGGABLE_TYPE = 'advanced-note-composer-reorder-row';

/**
 * The shape of `Draggable` this modal actually reads. Declared structurally rather than imported from
 * `obsidian-typings` so the narrowing below needs no cast: a real `Draggable` is assignable to it.
 */
interface ReorderDraggableCandidate {
  readonly source?: unknown;
  readonly type: string;
}

/**
 * What a dragged row carries in its `Draggable.source`.
 *
 * The identity travels WITH the drag rather than in a field on the modal. That is not a stylistic
 * preference: the field version (`draggedRowId`) was cleared at the top of the drop handler and then read
 * again by the same handler's group check, so every drop bailed out and dragging never moved anything
 * (issue #231). A value that is handed to the handler cannot be cleared out from under it.
 */
interface ReorderDragSource {
  readonly groupKey: string;
  readonly rowId: number;
}

interface ReorderModalConstructorParams {
  readonly app: App;
  readonly openParams: DidConfirmReorderModalParams;
  readonly promiseResolve: PromiseResolve<boolean>;
}

interface ReorderModalHandleDropParams {
  readonly dragSource: ReorderDragSource;
  readonly event: DragEvent;

  /**
   * Whether this is the hover pass (`dragenter`/`dragover`) rather than the drop itself.
   */
  readonly isOver: boolean;

  readonly itemEl: HTMLElement;
  readonly row: ReorderModalRow;
}
/* v8 ignore stop */

/* v8 ignore start -- ReorderModal is an internal UI class tested through the real app (integration). */
class ReorderModal extends Modal {
  private isConfirmed = false;
  private listEl: HTMLElement | null = null;
  private readonly params: DidConfirmReorderModalParams;
  private readonly promiseResolve: PromiseResolve<boolean>;

  public constructor(params: ReorderModalConstructorParams) {
    super(params.app);
    this.params = params.openParams;
    this.promiseResolve = params.promiseResolve;

    // No `Escape` registration, deliberately: Obsidian's own `Modal` already closes on `Escape` AND
    // `preventDefault`s it, so registering one here is dead code — established by mutation (deleting it
    // Left every assertion in `reorder-modal-escape.desktop.integration.test.ts` green), not by
    // Reading. Do not re-add it; what cancelling has to get right lives in `onClose` below, and that IS
    // Covered.
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

  /**
   * Handles both passes Obsidian's drag manager makes over a row: the hover pass, which only draws the
   * insertion line, and the drop pass, which performs the move.
   *
   * @param params - The parameters.
   */
  private handleDrop(params: ReorderModalHandleDropParams): void {
    const isAfter = this.checkIsAfter(params.event, params.itemEl);
    this.clearDropIndicators();

    if (params.isOver) {
      params.itemEl.addClass(isAfter ? DRAG_OVER_AFTER_CLASS : DRAG_OVER_BEFORE_CLASS);
      return;
    }

    if (params.dragSource.rowId === params.row.id) {
      return;
    }

    if (this.params.model.didMoveTo({ id: params.dragSource.rowId, isAfter, targetId: params.row.id })) {
      this.renderList();
    }
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

    // Obsidian's own drag manager rather than hand-rolled `dragstart`/`dragover`/`drop` listeners: it
    // Marks the element draggable, seeds the drag data store (an empty one is what Obsidian guards
    // Against for its own drags), registers `dragenter` alongside `dragover`, applies the `dropEffect`,
    // And draws the ghost — so a reorder drag looks and behaves like every other drag in the app.
    const dragSource: ReorderDragSource = { groupKey: row.groupKey, rowId: row.id };
    this.app.dragManager.handleDrag(itemEl, () => ({
      icon: DRAG_HANDLE_ICON_ID,
      source: dragSource,
      title: row.label,
      type: REORDER_DRAGGABLE_TYPE
    }));
    this.app.dragManager.handleDrop(itemEl, (event, draggable, isOver) => {
      const droppedSource = toReorderDragSource(draggable);
      // Refusing by returning `null` leaves the event un-`preventDefault`ed, which is what declines a row
      // From another group — and a file dragged in from the explorer — instead of accepting it.
      if (droppedSource?.groupKey !== row.groupKey) {
        return null;
      }

      this.handleDrop({ dragSource: droppedSource, event, isOver, itemEl, row });
      return { action: null, dropEffect: 'move' };
    });
    // A drag abandoned outside any row ends without a drop, so the last insertion line has to be cleared
    // Here; `dragend` fires on the row the drag started from.
    itemEl.addEventListener('dragend', () => {
      this.clearDropIndicators();
    });

    itemEl.createSpan({ cls: 'advanced-note-composer-reorder-handle' }, (handleEl) => {
      setIcon(handleEl, DRAG_HANDLE_ICON_ID);
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
 * that works by touch, while dragging is what makes a twenty-item list bearable. A drag never crosses a
 * group. Both paths are integration-tested — issue #231 shipped a drag that never moved anything because
 * only the arrows were, so "a click-driven test cannot drive this" is a reason to write the drag test, not
 * a reason to leave the interaction uncovered.
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

/**
 * Reads a row's identity back off whatever Obsidian's drag manager reports as being dragged.
 *
 * @param draggable - The dragged item, which is anything the app can drag — a file, a link, one of our
 * rows.
 * @returns The dragged row's identity, or `null` for any drag that did not start on one of our rows.
 */
function toReorderDragSource(draggable: ReorderDraggableCandidate): null | ReorderDragSource {
  if (draggable.type !== REORDER_DRAGGABLE_TYPE) {
    return null;
  }

  const source = draggable.source;
  if (typeof source !== 'object' || source === null || !('groupKey' in source) || !('rowId' in source)) {
    return null;
  }

  const groupKey = source.groupKey;
  const rowId = source.rowId;
  if (typeof groupKey !== 'string' || typeof rowId !== 'number') {
    return null;
  }

  return { groupKey, rowId };
}
/* v8 ignore stop */
