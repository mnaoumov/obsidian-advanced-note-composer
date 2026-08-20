import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentDelayedNotice
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { RenderInternalLinkParams } from 'obsidian-dev-utils/obsidian/markdown';

import { normalizeOptionalProperties } from 'obsidian-dev-utils/object-utils';
import { PluginNoticeMode } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
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
  MAX_LINKED_CREATED_NOTES,
  renderOperationNoticeLink,
  showOperationCompletionNotice,
  showOperationPermanentProgressNotice,
  showOperationProgressNotice
} from './operation-notices.ts';
import { showOperationProgressModal } from './operation-progress-modal.ts';
import { PluginSettings } from './plugin-settings.ts';

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

// The dialog opens a real Obsidian Modal and has its own suite; what this one asserts is which of the
// Two progress reporters the setting picks.
vi.mock('./operation-progress-modal.ts', () => ({
  showOperationProgressModal: vi.fn()
}));

const mockRenderInternalLink = vi.mocked(renderInternalLink);

const app = strictProxy<App>({});
const pluginSettingsComponent = createPluginSettingsComponent(true);
const folderNoteSettingsComponent = createFolderNoteSettingsComponent();
// `name` as well as `path`: the folder-note name template resolves `{{folderName}}` off it.
const folder = strictProxy<TFolder>({ name: 'charlie', path: 'charlie' });

interface RenderLinkParams {
  onClick?(this: void): Promise<void>;
  readonly path: string;

  /**
   * Only the folder-note bag is built from it, so every other case leaves it at the default.
   *
   * @default the module-level component
   */
  readonly pluginSettingsComponent?: PluginSettingsComponent;
}

interface RenderLinkResult {
  readonly aEl: HTMLAnchorElement;

  /**
   * What was forwarded to dev-utils — which, since it owns both the open and the reveal, is the whole of
   * what this wrapper decides.
   */
  readonly forwardedParams: RenderInternalLinkParams;
}

/**
 * A settings component naming folder notes explicitly, so the bag under assertion carries a location this
 * plugin chose rather than `Auto`, whose answer is the installed `folder-notes` plugin's.
 *
 * @returns The component.
 */
function createFolderNoteSettingsComponent(): PluginSettingsComponent {
  const settings = new PluginSettings();
  settings.folderNoteLocation = FolderNoteLocation.InsideFolder;
  return strictProxy<PluginSettingsComponent>({ settings });
}

function createPluginSettingsComponent(shouldShowOperationNotices: boolean, shouldBlockVaultDuringOperations = false): PluginSettingsComponent {
  const settings = new PluginSettings();
  settings.shouldShowOperationNotices = shouldShowOperationNotices;
  settings.shouldBlockVaultDuringOperations = shouldBlockVaultDuringOperations;
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

/**
 * Renders one notice link.
 *
 * @param params - The parameters.
 * @returns The rendered anchor and the parameters it was rendered through.
 */
async function renderLink(params: RenderLinkParams): Promise<RenderLinkResult> {
  const { onClick, path } = params;
  const aEl = await renderOperationNoticeLink(normalizeOptionalProperties<RenderOperationNoticeLinkParams>({
    app,
    onClick,
    pathOrAbstractFile: path,
    pluginSettingsComponent: params.pluginSettingsComponent ?? pluginSettingsComponent
  }));
  // Read off `lastCall` rather than asserted through `toHaveBeenCalledWith`: the parameters carry the
  // `strictProxy` app, and matching it deeply would probe properties the proxy refuses to answer.
  return { aEl, forwardedParams: ensureNonNullable(mockRenderInternalLink.mock.lastCall)[0] };
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
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      verb: 'Flattened folder'
    });

    expect(fragment.textContent).toBe('Flattened folder [alpha.md].');
  });

  it('should render the source and the target joined by the default preposition', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      targetPathOrAbstractFile: 'bravo.md',
      verb: 'Merged note'
    });

    expect(fragment.textContent).toBe('Merged note [alpha.md] into [bravo.md].');
  });

  it('should honor a custom preposition', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      pluginSettingsComponent,
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
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      suffix: ' and updated 3 links',
      verb: 'Renamed heading in'
    });

    expect(fragment.textContent).toBe('Renamed heading in [alpha.md] and updated 3 links.');
  });

  it('should render a consumed source as plain text rather than a link that would recreate it', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      pluginSettingsComponent,
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
      pluginSettingsComponent,
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
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      targetPathOrAbstractFile: 'bravo.md',
      verb: 'Merging note'
    });

    expect(fragment.textContent).toBe('Merging note [alpha.md] into [bravo.md]');
    expect(fragment.querySelector('.is-loading')).not.toBeNull();
  });

  it('should say nothing extra when the operation created nothing to name', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      createdPathsOrAbstractFiles: [],
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      verb: 'Split note'
    });

    expect(fragment.textContent).toBe('Split note [alpha.md].');
  });

  it('should name the notes the operation created after the suffix (#235)', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      createdPathsOrAbstractFiles: ['bravo.md'],
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      suffix: ' into 1 note(s)',
      verb: 'Split note'
    });

    // The source stays linked — a split leaves a residual link to everything it produced in the note it
    // Split, so it is the index this list is the shortcut past.
    expect(fragment.textContent).toBe('Split note [alpha.md] into 1 note(s): [bravo.md].');
  });

  it('should stop naming created notes at the cap and count the rest', async () => {
    const fragment = await buildOperationNoticeContent({
      app,
      createdPathsOrAbstractFiles: ['bravo.md', 'charlie.md', 'delta.md', 'echo.md', 'foxtrot.md'],
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      suffix: ' into 5 note(s)',
      verb: 'Split note'
    });

    expect(MAX_LINKED_CREATED_NOTES).toBe(3);
    expect(fragment.textContent).toBe('Split note [alpha.md] into 5 note(s): [bravo.md], [charlie.md], [delta.md] and 2 more.');
  });

  it('should name a created note once even when the operation split into it twice', async () => {
    const createdFile = strictProxy<TFile>({ path: 'bravo.md' });

    const fragment = await buildOperationNoticeContent({
      app,
      // Two headings with the same text split into the SAME note, so the destination is handed in twice.
      createdPathsOrAbstractFiles: [createdFile, 'bravo.md'],
      pluginSettingsComponent,
      sourcePathOrAbstractFile: 'alpha.md',
      suffix: ' into 2 note(s)',
      verb: 'Split note'
    });

    expect(fragment.textContent).toBe('Split note [alpha.md] into 2 note(s): [bravo.md].');
  });
});

/*
 * Both halves of what a notice link does to the vault are dev-utils' since 94.2.0, asked for by parameter: a
 * FILE link opens the note and also highlights it in the file explorer (issue #232, `shouldRevealFile`), and a
 * FOLDER link opens that folder's folder note (issue #234, `folderNote`). So what is asserted here is what is
 * FORWARDED — the wrapper's whole remaining job, plus the caller's own click hook, which the library has no
 * opinion about.
 */
describe('renderOperationNoticeLink', () => {
  it('should ask for the file reveal, which is what makes a file link read like a folder link (#232)', async () => {
    const { aEl, forwardedParams } = await renderLink({ path: 'alpha.md' });

    expect(forwardedParams.shouldRevealFile).toBe(true);
    expect(forwardedParams.pathOrAbstractFile).toBe('alpha.md');
    expect(aEl.textContent).toBe('[alpha.md]');
  });

  it('should resolve a folder link\'s note from the plugin\'s own Folder note settings (#234)', async () => {
    const { forwardedParams } = await renderLink({ path: 'charlie', pluginSettingsComponent: folderNoteSettingsComponent });

    // The settings' own answer to which note describes a folder — the same one `Rename folder...` and the
    // Reorder commands keep in step.
    expect(forwardedParams.folderNote?.location).toBe(FolderNoteLocation.InsideFolder);
    expect(forwardedParams.folderNote?.resolveName?.(folder)).toBe('charlie');
  });

  it('should name the folder note through the template, not the folder', async () => {
    const settings = new PluginSettings();
    settings.folderNoteLocation = FolderNoteLocation.InsideFolder;
    settings.folderNoteNameTemplate = 'index';

    const { forwardedParams } = await renderLink({
      path: 'charlie',
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });

    // Read at CLICK time through the callback, so a template changed after the notice was shown still
    // Applies — and a vault that names every folder note `index` is not answered with `charlie`.
    expect(forwardedParams.folderNote?.resolveName?.(folder)).toBe('index');
  });

  it('should run the extra click action', async () => {
    const onClick = vi.fn().mockResolvedValue(undefined);

    const { aEl } = await renderLink({ onClick, path: 'alpha.md' });
    aEl.dispatchEvent(new MouseEvent('click'));

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
      app,
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
      app,
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
      app,
      content: emptyContent,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNoticeAfterDelay }),
      pluginSettingsComponent: createPluginSettingsComponent(false)
    });

    expect(result).toBeNull();
    expect(showNoticeAfterDelay).not.toHaveBeenCalled();
  });

  it('should show the blocking dialog instead of a notice when asked to (issue #247)', async () => {
    const handle = strictProxy<PluginNoticeComponentDelayedNotice>({});
    vi.mocked(showOperationProgressModal).mockReturnValue(handle);
    const showNoticeAfterDelay = vi.fn();
    const settingsComponent = createPluginSettingsComponent(true, true);
    const abortController = new AbortController();

    const result = showOperationProgressNotice({
      abortController,
      app,
      content: emptyContent,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNoticeAfterDelay }),
      pluginSettingsComponent: settingsComponent
    });

    expect(result).toBe(handle);
    expect(showNoticeAfterDelay).not.toHaveBeenCalled();
    // Field by field rather than `objectContaining`: the app is a strict proxy, and a failed deep
    // Comparison would try to print it.
    const params = vi.mocked(showOperationProgressModal).mock.calls[0]?.[0];
    expect(params?.abortController).toBe(abortController);
    expect(params?.app).toBe(app);
    // The dialog resolves the same lazy content provider the notice would have. Identity is not the
    // Point and would not hold: the provider builds a fresh fragment per call.
    await expect(params?.content()).resolves.toBeInstanceOf(DocumentFragment);
  });

  it('should give the dialog its own abort controller when the operation has none', () => {
    // The dialog always offers Cancel, so it needs something to abort even when the operation would
    // Not have offered one.
    vi.mocked(showOperationProgressModal).mockReturnValue(strictProxy<PluginNoticeComponentDelayedNotice>({}));
    const settingsComponent = createPluginSettingsComponent(true, true);

    showOperationProgressNotice({
      app,
      content: emptyContent,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNoticeAfterDelay: vi.fn() }),
      pluginSettingsComponent: settingsComponent
    });

    expect(vi.mocked(showOperationProgressModal).mock.calls[0]?.[0].abortController).toBeInstanceOf(AbortController);
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
