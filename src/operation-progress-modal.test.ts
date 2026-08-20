import type { App } from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import { waitForAllAsyncOperations } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { flushQueue } from 'obsidian-dev-utils/obsidian/queue';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { showOperationProgressModal } from './operation-progress-modal.ts';

interface ModalProbe {
  close(): void;
  closeCallCount: number;
  contentEl: HTMLElement;
  isOpen: boolean;
  modalEl: HTMLElement;
  onOpen(): void;
  open(): void;
  titleEl: HTMLElement;
}

interface TestButtonComponent {
  readonly buttonEl: HTMLButtonElement;
  simulateClick__(): void;
}

const modals: ModalProbe[] = [];
const buttons: TestButtonComponent[] = [];

vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('obsidian')>();

  class MockModal implements ModalProbe {
    public closeCallCount = 0;
    public contentEl = createDiv();
    public isOpen = false;
    public modalEl = createDiv();
    public titleEl = createDiv();

    public close(): void {
      this.closeCallCount++;
      this.isOpen = false;
    }

    public onOpen(): void {
      // Overridden by the subclass under test.
    }

    public open(): void {
      this.isOpen = true;
      modals.push(this);
      this.onOpen();
    }
  }

  // Captured on construction: the dialog builds its own Cancel button, so there is no other way to
  // Reach the component (and the mock button reacts to `simulateClick__`, not to a DOM click).
  class CapturingButtonComponent extends original.ButtonComponent {
    public constructor(containerEl: HTMLElement) {
      super(containerEl);
      buttons.push(castTo<TestButtonComponent>(this));
    }
  }

  return {
    ...original,
    ButtonComponent: CapturingButtonComponent,
    Modal: MockModal
  };
});

vi.mock('obsidian-dev-utils/obsidian/queue', () => ({
  flushQueue: vi.fn().mockResolvedValue(undefined)
}));

const APP = strictProxy<App>({});

function getModal(): ModalProbe {
  const modal = modals[0];
  if (!modal) {
    throw new Error('The dialog was never opened.');
  }
  return modal;
}

describe('showOperationProgressModal', () => {
  beforeEach(() => {
    modals.length = 0;
    buttons.length = 0;
    vi.mocked(flushQueue).mockClear().mockResolvedValue(undefined);
  });

  function show(): ReturnType<typeof showOperationProgressModal> {
    return showOperationProgressModal({
      abortController: new AbortController(),
      app: APP,
      content: () => Promise.resolve('Merging folders')
    });
  }

  it('should open a dialog and show the operation content', async () => {
    show();
    await waitForAllAsyncOperations();

    expect(getModal().isOpen).toBe(true);
    expect(getModal().contentEl.textContent).toContain('Merging folders');
  });

  it('should remove the close button, since it would refuse to work anyway', () => {
    const modal = createDiv();
    modal.createDiv({ cls: 'modal-close-button' });
    show();

    expect(getModal().modalEl.querySelector('.modal-close-button')).toBeNull();
  });

  it('should refuse to close while the operation is running', () => {
    show();

    getModal().close();

    // The mock counts the call; what matters is that the dialog is still open.
    expect(getModal().isOpen).toBe(true);
  });

  it('should offer a Cancel button that aborts the operation', () => {
    // Blocking the vault without offering a way out would be a trap.
    const abortController = new AbortController();
    showOperationProgressModal({
      abortController,
      app: APP,
      content: () => Promise.resolve('Merging folders')
    });

    const cancelButton = buttons.find((button) => button.buttonEl.textContent === 'Cancel');
    expect(cancelButton).toBeDefined();

    cancelButton?.simulateClick__();

    expect(abortController.signal.aborted).toBe(true);
  });

  it('should report the current phase', async () => {
    const handle = show();
    await waitForAllAsyncOperations();

    handle.setContent('Updating links');

    expect(getModal().contentEl.textContent).toContain('Updating links');
  });

  it('should wait for the queued work to drain before closing', async () => {
    let resolveFlush!: PromiseResolve<void>;
    vi.mocked(flushQueue).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFlush = resolve;
      })
    );

    const handle = show();
    await waitForAllAsyncOperations();

    handle[Symbol.dispose]();
    // Disposing is not closing: this is the whole point of the request, since the reporter's own
    // Mock-up closed here and left the links still updating.
    expect(getModal().isOpen).toBe(true);

    resolveFlush();
    await waitForAllAsyncOperations();

    expect(getModal().isOpen).toBe(false);
  });

  it('should give the vault back even when draining fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(flushQueue).mockRejectedValue(new Error('queue exploded'));

    const handle = show();
    await waitForAllAsyncOperations();
    handle[Symbol.dispose]();
    await waitForAllAsyncOperations();

    // A dialog that cannot be dismissed and never closes is worse than the problem it solves.
    expect(getModal().isOpen).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('drain'), expect.any(Error));
    warnSpy.mockRestore();
  });

  it('should ignore a second disposal', async () => {
    const handle = show();
    await waitForAllAsyncOperations();

    handle[Symbol.dispose]();
    handle[Symbol.dispose]();
    await waitForAllAsyncOperations();

    expect(vi.mocked(flushQueue)).toHaveBeenCalledOnce();
  });

  it('should ignore content updates after disposal', async () => {
    const handle = show();
    await waitForAllAsyncOperations();

    handle[Symbol.dispose]();
    handle.setContent('too late');
    await waitForAllAsyncOperations();

    expect(getModal().contentEl.textContent).not.toContain('too late');
  });

  it('should accept a fragment as content', async () => {
    const handle = show();
    await waitForAllAsyncOperations();

    const fragment = castTo<DocumentFragment>(createFragment());
    fragment.append(document.createTextNode('Renaming folders'));
    handle.setContent(fragment);

    expect(getModal().contentEl.textContent).toContain('Renaming folders');
  });
});
