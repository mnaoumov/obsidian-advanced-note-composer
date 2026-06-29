import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import { Modal } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { openProgressModal } from './progress-modal.ts';

interface RenderInternalLinkParams {
  readonly pathOrAbstractFile: string;
}

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn(({ pathOrAbstractFile }: RenderInternalLinkParams) => {
    const anchorEl = activeDocument.createElement('a');
    anchorEl.addClass('internal-link');
    anchorEl.textContent = pathOrAbstractFile;
    return Promise.resolve(anchorEl);
  })
}));

let app: AppOriginal;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openProgressModal', () => {
  it('opens a minimizable modal titled for the operation with links to the source and target', async () => {
    const setTitleSpy = vi.spyOn(Modal.prototype, 'setTitle');
    const openSpy = vi.spyOn(Modal.prototype, 'open');
    const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md' });
    const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md' });

    await openProgressModal({
      app,
      sourceFile,
      targetFile,
      verb: 'Splitting'
    });

    expect(setTitleSpy).toHaveBeenCalledWith('Advanced Note Composer: Splitting note');
    expect(openSpy).toHaveBeenCalledTimes(1);

    const modal = castTo<Modal>(openSpy.mock.contexts[0]);
    expect(modal.contentEl.textContent).toContain('Splitting note');
    const linkEls = modal.contentEl.querySelectorAll('a.internal-link');
    expect(linkEls.length).toBe(2);
    expect(linkEls[0]?.textContent).toBe('source.md');
    expect(linkEls[1]?.textContent).toBe('target.md');
    expect(modal.contentEl.querySelector('.is-loading')).not.toBeNull();
  });

  it('closes the modal when the returned handle is closed', async () => {
    const closeSpy = vi.spyOn(Modal.prototype, 'close');

    const handle = await openProgressModal({
      app,
      sourceFile: strictProxy<TFile>({ basename: 'source', path: 'source.md' }),
      targetFile: strictProxy<TFile>({ basename: 'target', path: 'target.md' }),
      verb: 'Merging'
    });

    expect(closeSpy).not.toHaveBeenCalled();

    handle.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
