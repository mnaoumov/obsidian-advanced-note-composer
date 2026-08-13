import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentDelayedNotice
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { normalizeOptionalProperties } from 'obsidian-dev-utils/object-utils';
import { PluginNoticeMode } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import {
  getAbstractFileOrNull,
  isFile
} from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { RenderOperationNoticeLinkParams } from './operation-notices.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  buildOperationNoticeContent,
  renderOperationNoticeLink,
  showOperationCompletionNotice,
  showOperationPermanentProgressNotice,
  showOperationProgressNotice
} from './operation-notices.ts';
import { PluginSettings } from './plugin-settings.ts';

vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  getAbstractFileOrNull: vi.fn(),
  isFile: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

const mockGetAbstractFileOrNull = vi.mocked(getAbstractFileOrNull);
const mockIsFile = vi.mocked(isFile);
const mockRenderInternalLink = vi.mocked(renderInternalLink);

const app = strictProxy<App>({});

interface ClickLinkParams {
  readonly app: App;
  onClick?(this: void): Promise<void>;
  readonly path: string;
}

interface ClickLinkResult {
  readonly aEl: HTMLAnchorElement;
  readonly wasDefaultPrevented: boolean;
}

/**
 * Renders one notice link and clicks it.
 *
 * @param params - The parameters.
 * @returns The rendered anchor and whether the click's default was prevented.
 */
async function clickLink(params: ClickLinkParams): Promise<ClickLinkResult> {
  const { app: linkApp, onClick, path } = params;
  const aEl = await renderOperationNoticeLink(normalizeOptionalProperties<RenderOperationNoticeLinkParams>({
    app: linkApp,
    onClick,
    pathOrAbstractFile: path
  }));
  // `cancelable` so `defaultPrevented` means something — a non-cancelable event reports `false` no matter
  // What the listener did, which would make the assertion vacuous.
  const $event = new MouseEvent('click', { cancelable: true });
  aEl.dispatchEvent($event);
  return { aEl, wasDefaultPrevented: $event.defaultPrevented };
}

function createAppWithFileExplorer(revealInFolder: () => void): App {
  return strictProxy<App>({
    internalPlugins: strictProxy<App['internalPlugins']>({
      getEnabledPluginById: vi.fn().mockReturnValue({ revealInFolder })
    })
  });
}

function createPluginSettingsComponent(shouldShowOperationNotices: boolean): PluginSettingsComponent {
  const settings = new PluginSettings();
  settings.shouldShowOperationNotices = shouldShowOperationNotices;
  return strictProxy<PluginSettingsComponent>({ settings });
}

/**
 * A stand-in for the lazy notice-content builder — this suite asserts how it is forwarded, not what it
 * renders (that is `buildOperationNoticeContent`'s own suite).
 *
 * @returns An empty fragment.
 */
function emptyContent(): Promise<DocumentFragment> {
  return Promise.resolve(createFragment());
}

beforeEach(() => {
  mockRenderInternalLink.mockImplementation((params) => {
    const path = typeof params.pathOrAbstractFile === 'string' ? params.pathOrAbstractFile : params.pathOrAbstractFile.path;
    return Promise.resolve(createEl('a', { text: `[${path}]` }));
  });
});

describe('buildOperationNoticeContent', () => {
  it('should render the source alone when there is no target', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      sourcePathOrAbstractFile: 'alpha.md',
      verb: 'Flattened folder'
    });

    expect(fragment.textContent).toBe('Flattened folder [alpha.md].');
  });

  it('should render the source and the target joined by the default preposition', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      sourcePathOrAbstractFile: 'alpha.md',
      targetPathOrAbstractFile: 'bravo.md',
      verb: 'Merged note'
    });

    expect(fragment.textContent).toBe('Merged note [alpha.md] into [bravo.md].');
  });

  it('should honor a custom preposition', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      preposition: 'with',
      sourcePathOrAbstractFile: 'alpha.md',
      targetPathOrAbstractFile: 'bravo.md',
      verb: 'Swapped'
    });

    expect(fragment.textContent).toBe('Swapped [alpha.md] with [bravo.md].');
  });

  it('should append the suffix before the terminating period', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      sourcePathOrAbstractFile: 'alpha.md',
      suffix: ' and updated 3 links',
      verb: 'Renamed heading in'
    });

    expect(fragment.textContent).toBe('Renamed heading in [alpha.md] and updated 3 links.');
  });

  it('should render a consumed source as plain text rather than a link that would recreate it', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      shouldLinkSource: false,
      sourcePathOrAbstractFile: 'alpha.md',
      targetPathOrAbstractFile: 'bravo.md',
      verb: 'Merged note'
    });

    expect(fragment.textContent).toBe('Merged note alpha.md into [bravo.md].');
  });

  it('should render a consumed source given as an abstract file by its path', async () => {
    const sourceFile = strictProxy<TFile>({ path: 'charlie/delta.md' });

    const fragment = await buildOperationNoticeContent({
      app,
      shouldLinkSource: false,
      sourcePathOrAbstractFile: sourceFile,
      verb: 'Merged note'
    });

    expect(fragment.textContent).toBe('Merged note charlie/delta.md.');
  });

  it('should end with a loading indicator instead of a period while the operation runs', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      isLoading: true,
      sourcePathOrAbstractFile: 'alpha.md',
      targetPathOrAbstractFile: 'bravo.md',
      verb: 'Merging note'
    });

    expect(fragment.textContent).toBe('Merging note [alpha.md] into [bravo.md]');
    expect(fragment.querySelector('.is-loading')).not.toBeNull();
  });
});

/*
 * Issue #232: a notice's file link opens the note (Obsidian's own handler, on the anchor
 * `renderInternalLink` produced) and ALSO highlights it in the file explorer. The reveal is what the reporter
 * asked for "to stay consistent with #234" — a folder link has always revealed, because revealing is the only
 * thing clicking a folder can mean.
 */
describe('renderOperationNoticeLink', () => {
  it('should reveal the file in the explorer on click, without preventing the open', async () => {
    const revealInFolder = vi.fn();
    const file = strictProxy<TFile>({ path: 'alpha.md' });
    mockGetAbstractFileOrNull.mockReturnValue(file);
    mockIsFile.mockReturnValue(true);

    const { aEl, wasDefaultPrevented } = await clickLink({ app: createAppWithFileExplorer(revealInFolder), path: 'alpha.md' });

    expect(revealInFolder).toHaveBeenCalledExactlyOnceWith(file);
    // No `preventDefault`: the reveal is layered ON TOP of Obsidian's open, never instead of it.
    expect(wasDefaultPrevented).toBe(false);
    expect(aEl.textContent).toBe('[alpha.md]');
  });

  it('should reveal nothing for a folder, whose click dev-utils already owns', async () => {
    const revealInFolder = vi.fn();
    mockGetAbstractFileOrNull.mockReturnValue(strictProxy<TFolder>({ path: 'charlie' }));
    mockIsFile.mockReturnValue(false);

    await clickLink({ app: createAppWithFileExplorer(revealInFolder), path: 'charlie' });

    // Revealing again here would be a SECOND reveal on the same click, not a missing one.
    expect(revealInFolder).not.toHaveBeenCalled();
  });

  it('should reveal nothing when the path no longer resolves', async () => {
    const revealInFolder = vi.fn();
    // Resolved at CLICK time, so a destination trashed since the notice was shown simply has nothing to
    // Reveal — and must not be recreated on the way to finding that out.
    mockGetAbstractFileOrNull.mockReturnValue(null);
    mockIsFile.mockReturnValue(false);

    await clickLink({ app: createAppWithFileExplorer(revealInFolder), path: 'gone.md' });

    expect(revealInFolder).not.toHaveBeenCalled();
  });

  it('should survive the file explorer being disabled', async () => {
    mockGetAbstractFileOrNull.mockReturnValue(strictProxy<TFile>({ path: 'alpha.md' }));
    mockIsFile.mockReturnValue(true);
    const appWithoutFileExplorer = strictProxy<App>({
      internalPlugins: strictProxy<App['internalPlugins']>({ getEnabledPluginById: vi.fn().mockReturnValue(null) })
    });

    await expect(clickLink({ app: appWithoutFileExplorer, path: 'alpha.md' })).resolves.toBeDefined();
  });

  it('should run the extra click action', async () => {
    mockGetAbstractFileOrNull.mockReturnValue(strictProxy<TFile>({ path: 'alpha.md' }));
    mockIsFile.mockReturnValue(true);
    const onClick = vi.fn().mockResolvedValue(undefined);

    await clickLink({ app: createAppWithFileExplorer(vi.fn()), onClick, path: 'alpha.md' });

    // Fired through `invokeAsyncSafely`, so it is in flight rather than awaited by the DOM listener.
    await vi.waitFor(() => {
      expect(onClick).toHaveBeenCalledOnce();
    });
  });
});

describe('showOperationCompletionNotice', () => {
  it('should show the notice when the setting is on', () => {
    const showNotice = vi.fn();
    showOperationCompletionNotice({
      content: 'Merged.',
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: createPluginSettingsComponent(true)
    });

    expect(showNotice).toHaveBeenCalledExactlyOnceWith('Merged.', { mode: PluginNoticeMode.Separate });
  });

  it('should show nothing when the setting is off', () => {
    const showNotice = vi.fn();
    showOperationCompletionNotice({
      content: 'Merged.',
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: createPluginSettingsComponent(false)
    });

    expect(showNotice).not.toHaveBeenCalled();
  });
});

describe('showOperationProgressNotice', () => {
  it('should show the delayed notice when the setting is on', () => {
    const delayedNotice = strictProxy<PluginNoticeComponentDelayedNotice>({});
    const showNoticeAfterDelay = vi.fn().mockReturnValue(delayedNotice);
    const abortController = new AbortController();

    const result = showOperationProgressNotice({
      abortController,
      content: emptyContent,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNoticeAfterDelay }),
      pluginSettingsComponent: createPluginSettingsComponent(true)
    });

    expect(result).toBe(delayedNotice);
    expect(showNoticeAfterDelay).toHaveBeenCalledExactlyOnceWith({ abortController, content: emptyContent });
  });

  it('should offer no Cancel button when the operation has no abort controller', () => {
    const showNoticeAfterDelay = vi.fn().mockReturnValue(strictProxy<PluginNoticeComponentDelayedNotice>({}));

    showOperationProgressNotice({
      content: emptyContent,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNoticeAfterDelay }),
      pluginSettingsComponent: createPluginSettingsComponent(true)
    });

    expect(showNoticeAfterDelay).toHaveBeenCalledExactlyOnceWith({ content: emptyContent });
  });

  it('should return null and show nothing when the setting is off', () => {
    const showNoticeAfterDelay = vi.fn();

    const result = showOperationProgressNotice({
      abortController: new AbortController(),
      content: emptyContent,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNoticeAfterDelay }),
      pluginSettingsComponent: createPluginSettingsComponent(false)
    });

    expect(result).toBeNull();
    expect(showNoticeAfterDelay).not.toHaveBeenCalled();
  });
});

describe('showOperationPermanentProgressNotice', () => {
  it('should show a permanent notice when the setting is on', () => {
    const showNotice = vi.fn();
    const content = createFragment();

    showOperationPermanentProgressNotice({
      content,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: createPluginSettingsComponent(true)
    });

    expect(showNotice).toHaveBeenCalledExactlyOnceWith(content, { isPermanent: true });
  });

  it('should return null and show nothing when the setting is off', () => {
    const showNotice = vi.fn();

    const result = showOperationPermanentProgressNotice({
      content: createFragment(),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: createPluginSettingsComponent(false)
    });

    expect(result).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
  });
});
