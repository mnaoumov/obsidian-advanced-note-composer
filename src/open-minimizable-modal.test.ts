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

import { openMinimizableModal } from './open-minimizable-modal.ts';

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
});
