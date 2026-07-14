import type { App as AppOriginal } from 'obsidian';

import { Modal } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
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
