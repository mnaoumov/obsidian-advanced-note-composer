import type {
  App,
  Notice,
  TFile
} from 'obsidian';
import type {
  Mock,
  MockInstance
} from 'vitest';

import {
  sleep,
  waitForAllAsyncOperations
} from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { showProgressNotice } from './progress-notice.ts';

interface RenderInternalLinkParams {
  readonly pathOrAbstractFile: string;
}

interface RunOperationParams {
  readonly delayMilliseconds?: number;
  readonly operationDurationMilliseconds: number;
}

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn(({ pathOrAbstractFile }: RenderInternalLinkParams) => {
    // Create a detached anchor (via a fragment) so it can be appended into the notice fragment.
    const anchorEl = createFragment().createEl('a', { cls: 'internal-link', text: pathOrAbstractFile });
    return Promise.resolve(anchorEl);
  })
}));

// Mirrors the module's own default so the default-delay assertions do not hardcode a bare literal.
const DEFAULT_DELAY_BEFORE_SHOW_IN_MILLISECONDS = 500;
// A short delay for the parametrized operation-duration tests (they run in real time).
const NOTICE_DELAY_IN_MILLISECONDS = 100;

const app = strictProxy<App>({});
const sourceFile = strictProxy<TFile>({ basename: 'source', path: 'source.md' });
const targetFile = strictProxy<TFile>({ basename: 'target', path: 'target.md' });

let hideMock: Mock;
let pluginNoticeComponent: PluginNoticeComponent;
let showNoticeSpy: MockInstance<PluginNoticeComponent['showNotice']>;

beforeEach(() => {
  hideMock = vi.fn();
  pluginNoticeComponent = new PluginNoticeComponent('Advanced Note Composer');
  showNoticeSpy = vi.spyOn(pluginNoticeComponent, 'showNotice').mockReturnValue(strictProxy<Notice>({ hide: hideMock }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('showProgressNotice', () => {
  // Wraps an operation of the given duration exactly as the composers do — show the notice, run the operation, then close the handle — so the operation duration is the only variable.
  async function runOperation(params: RunOperationParams): Promise<void> {
    const handle = showProgressNotice({
      app,
      pluginNoticeComponent,
      sourceFile,
      targetFile,
      verb: 'Splitting',
      ...params.delayMilliseconds === undefined ? {} : { delayMilliseconds: params.delayMilliseconds }
    });

    await sleep({ milliseconds: params.operationDurationMilliseconds });
    // Let a notice that fired during the operation finish rendering before the operation ends.
    await waitForAllAsyncOperations();
    handle.close();
    await waitForAllAsyncOperations();
  }

  it.each([
    { operationDurationMilliseconds: 0 },
    { operationDurationMilliseconds: 30 }
  ])('shows no notice for an operation that finishes in $operationDurationMilliseconds ms (faster than the delay)', async ({ operationDurationMilliseconds }) => {
    await runOperation({ delayMilliseconds: NOTICE_DELAY_IN_MILLISECONDS, operationDurationMilliseconds });

    expect(showNoticeSpy).not.toHaveBeenCalled();
    expect(hideMock).not.toHaveBeenCalled();
  });

  it.each([
    { operationDurationMilliseconds: 200 },
    { operationDurationMilliseconds: 400 }
  ])('shows then hides the notice for an operation that runs $operationDurationMilliseconds ms (slower than the delay)', async ({ operationDurationMilliseconds }) => {
    await runOperation({ delayMilliseconds: NOTICE_DELAY_IN_MILLISECONDS, operationDurationMilliseconds });

    expect(showNoticeSpy).toHaveBeenCalledTimes(1);
    expect(hideMock).toHaveBeenCalledTimes(1);

    const [message, options] = showNoticeSpy.mock.calls[0] ?? [];
    const fragment = castTo<DocumentFragment>(message);
    expect(fragment.textContent).toContain('Splitting note');
    const linkEls = fragment.querySelectorAll('a.internal-link');
    expect(linkEls.length).toBe(2);
    expect(linkEls[0]?.textContent).toBe('source.md');
    expect(linkEls[1]?.textContent).toBe('target.md');
    expect(options).toEqual({ isPermanent: true });
  });

  it('shows the notice only after the default delay of 500 ms when no delay is provided', async () => {
    const handle = showProgressNotice({ app, pluginNoticeComponent, sourceFile, targetFile, verb: 'Splitting' });

    await sleep({ milliseconds: DEFAULT_DELAY_BEFORE_SHOW_IN_MILLISECONDS - 100 });
    await waitForAllAsyncOperations();
    expect(showNoticeSpy).not.toHaveBeenCalled();

    await sleep({ milliseconds: 200 });
    await waitForAllAsyncOperations();
    expect(showNoticeSpy).toHaveBeenCalledTimes(1);

    handle.close();
    await waitForAllAsyncOperations();
    expect(hideMock).toHaveBeenCalledTimes(1);
  });

  it('does not show the notice when closed while it is being built', async () => {
    vi.useFakeTimers();
    try {
      const handle = showProgressNotice({ app, delayMilliseconds: NOTICE_DELAY_IN_MILLISECONDS, pluginNoticeComponent, sourceFile, targetFile, verb: 'Splitting' });

      // Fire the delay timer so the async build starts, then close before its awaits are flushed.
      vi.advanceTimersByTime(NOTICE_DELAY_IN_MILLISECONDS);
      handle.close();
      await waitForAllAsyncOperations();

      expect(showNoticeSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
