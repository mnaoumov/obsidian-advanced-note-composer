import type {
  Notice,
  TFile
} from 'obsidian';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Selection } from './composers/composer-base.ts';
import type { MoveNoticeComponent } from './move-notice-component.ts';
import type { SelectionHighlightComponent } from './selection-highlight-component.ts';

import { markSelectionToMove } from './mark-selection-to-move.ts';
import { MoveSelectionBuffer } from './move-selection-buffer.ts';

interface LockForPathOptions {
  readonly abortController?: AbortController;
}

const CAPTURED_SELECTIONS: Selection[] = [{ endOffset: 12, startOffset: 5 }];

interface TestContext {
  readonly capturedAbortControllers: AbortController[];
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly disposeHighlight: ReturnType<typeof vi.fn>;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly notice: Notice;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
  readonly sourceFile: TFile;
}

function createContext(): TestContext {
  const capturedAbortControllers: AbortController[] = [];
  const dispose = vi.fn();
  const disposeHighlight = vi.fn();
  const notice = strictProxy<Notice>({ hide: vi.fn() });
  return {
    capturedAbortControllers,
    dispose,
    disposeHighlight,
    moveNoticeComponent: strictProxy<MoveNoticeComponent>({
      refreshButtons: vi.fn(),
      showNotice: vi.fn().mockReturnValue(notice)
    }),
    moveSelectionBuffer: new MoveSelectionBuffer(),
    notice,
    resourceLockComponent: strictProxy<ResourceLockComponent>({
      lockForPath: vi.fn().mockImplementation((_pathOrFile, options?: LockForPathOptions) => {
        if (options?.abortController) {
          capturedAbortControllers.push(options.abortController);
        }
        return { [Symbol.dispose]: dispose };
      })
    }),
    selectionHighlightComponent: strictProxy<SelectionHighlightComponent>({
      addHighlight: vi.fn().mockReturnValue({ [Symbol.dispose]: disposeHighlight })
    }),
    sourceFile: strictProxy<TFile>({
      path: 'source.md',
      stat: strictProxy({ mtime: 4321 })
    })
  };
}

function mark(context: TestContext): void {
  markSelectionToMove({
    capturedSelections: CAPTURED_SELECTIONS,
    moveNoticeComponent: context.moveNoticeComponent,
    moveSelectionBuffer: context.moveSelectionBuffer,
    resourceLockComponent: context.resourceLockComponent,
    selectedText: 'marked text',
    selectionHighlightComponent: context.selectionHighlightComponent,
    sourceFile: context.sourceFile
  });
}

describe('markSelectionToMove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks the source, shows the notice, marks the buffer, and seeds the buttons', () => {
    const context = createContext();
    mark(context);

    expect(context.resourceLockComponent.lockForPath).toHaveBeenCalledWith(
      context.sourceFile,
      expect.objectContaining({ shouldBlockMutations: true })
    );
    expect(context.moveNoticeComponent.showNotice).toHaveBeenCalledOnce();
    expect(context.moveNoticeComponent.refreshButtons).toHaveBeenCalledOnce();
    expect(context.selectionHighlightComponent.addHighlight).toHaveBeenCalledWith(context.sourceFile, CAPTURED_SELECTIONS);

    const marked = context.moveSelectionBuffer.get();
    expect(marked?.capturedSelections).toBe(CAPTURED_SELECTIONS);
    expect(marked?.selectedText).toBe('marked text');
    expect(marked?.sourceFile).toBe(context.sourceFile);
    expect(marked?.sourceMtime).toBe(4321);
    expect(marked?.notice).toBe(context.notice);
  });

  it('clears the mark when the source lock is aborted (e.g. Unlock active note)', () => {
    const context = createContext();
    mark(context);
    expect(context.moveSelectionBuffer.hasMark()).toBe(true);

    context.capturedAbortControllers[0]?.abort();

    expect(context.moveSelectionBuffer.hasMark()).toBe(false);
    expect(context.notice.hide).toHaveBeenCalledOnce();
    expect(context.dispose).toHaveBeenCalled();
    expect(context.disposeHighlight).toHaveBeenCalled();
  });

  it('does not clear a newer mark when a stale controller aborts', () => {
    const context = createContext();
    mark(context);
    const firstController = context.capturedAbortControllers[0];

    // A second mark replaces the first; the first's controller is now stale.
    mark(context);
    const secondMarked = context.moveSelectionBuffer.get();

    firstController?.abort();

    expect(context.moveSelectionBuffer.get()).toBe(secondMarked);
    expect(context.moveSelectionBuffer.hasMark()).toBe(true);
  });
});
