import type { App as AppOriginal } from 'obsidian';

import { Modal } from 'obsidian';
import {
  noop,
  noopAsync
} from 'obsidian-dev-utils/function';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { ConfirmDialogModal } from './modals/confirm-dialog-modal.ts';
import {
  openConfirmDialogModal,
  openMinimizableModal,
  openModal
} from './open-minimizable-modal.ts';

let app: AppOriginal;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openConfirmDialogModal', () => {
  // Issue #201: three flows opened their confirmation dialog through `openModal` and shipped without a
  // Minimize button. The opener is what makes that impossible to write, so it is what gets pinned here.
  it('adds a minimize button to every confirmation dialog', () => {
    const openSpy = vi.spyOn(Modal.prototype, 'open').mockImplementation(noop);
    const modal = createConfirmDialogModal();

    openConfirmDialogModal(modal);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(modal.modalEl.querySelector('.minimize-button')).not.toBeNull();
  });

  it('closes the dialog when the abort controller aborts', () => {
    vi.spyOn(Modal.prototype, 'open').mockImplementation(noop);
    const closeSpy = vi.spyOn(Modal.prototype, 'close');
    const modal = createConfirmDialogModal();
    const abortController = new AbortController();

    openConfirmDialogModal(modal, abortController);
    abortController.abort();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('openMinimizableModal', () => {
  it('opens the wrapped modal and adds a minimize button', () => {
    const openSpy = vi.spyOn(Modal.prototype, 'open');
    const modal = new Modal(app);

    openMinimizableModal(modal);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(modal.modalEl.querySelector('.minimize-button')).not.toBeNull();
  });

  it('closes the modal when the abort controller aborts', () => {
    const closeSpy = vi.spyOn(Modal.prototype, 'close');
    const modal = new Modal(app);
    const abortController = new AbortController();

    openMinimizableModal(modal, abortController);
    abortController.abort();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

function createConfirmDialogModal(): ConfirmDialogModal {
  return new ConfirmDialogModal({
    app,
    buildContent: noopAsync,
    canReselectTarget: true,
    confirmButtonMobileText: 'Confirm and don\'t ask again',
    confirmButtonText: 'Confirm',
    promiseResolve: noop,
    title: 'Confirm'
  });
}

describe('openModal', () => {
  it('opens the modal without adding a minimize button', () => {
    const openSpy = vi.spyOn(Modal.prototype, 'open');
    const modal = new Modal(app);

    openModal(modal);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(modal.modalEl.querySelector('.minimize-button')).toBeNull();
  });

  it('closes the modal when the abort controller aborts', () => {
    const closeSpy = vi.spyOn(Modal.prototype, 'close');
    const modal = new Modal(app);
    const abortController = new AbortController();

    openModal(modal, abortController);
    abortController.abort();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
