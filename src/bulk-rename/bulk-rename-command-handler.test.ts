import type {
  AbstractFileCommandHandlerShouldAddToAbstractFileMenuParams,
  AbstractFileCommandHandlerShouldAddToAbstractFilesMenuParams
} from '@mnaoumov/obsidian-lib/command-handlers/abstract-file-command-handler';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App as AppOriginal,
  TAbstractFile
} from 'obsidian';
import type { MockInstance } from 'vitest';

import { FolderNoteLocation } from '@mnaoumov/obsidian-lib/folder-note';
import {
  requestResourceUnlockForPath,
  ResourceLockComponent
} from '@mnaoumov/obsidian-lib/resource-lock';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BulkOperationRunnerStub } from '../bulk-operations/bulk-operation-runner-stub.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../settings/plugin-settings.ts';
import type {
  SelectBulkRenameRequest,
  SelectBulkRenameRequestParams
} from './bulk-rename-command-handler.ts';
import type { BulkRenameRequest } from './bulk-rename-plan.ts';

import { createBulkOperationRunnerStub } from '../bulk-operations/bulk-operation-runner-stub.ts';
import { BulkRenameCommandHandler } from './bulk-rename-command-handler.ts';
import { DEFAULT_BULK_RENAME_REQUEST } from './bulk-rename-plan.ts';

interface HandlerContext {
  readonly handler: Testable;
  readonly selectOptions: MockInstance<SelectBulkRenameRequest>;
  readonly showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface Testable {
  readonly canExecute: () => boolean;
  readonly canExecuteAbstractFile: (abstractFile: TAbstractFile) => boolean;
  readonly canExecuteAbstractFiles: (abstractFiles: TAbstractFile[]) => boolean;
  readonly executeAbstractFile: (abstractFile: TAbstractFile) => Promise<void>;
  readonly executeAbstractFiles: (abstractFiles: TAbstractFile[]) => Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  readonly resolveTemporaryPath: (desiredPath: string, isFolderPath: boolean) => string;
  readonly shouldAddCommandToSubmenu: () => boolean;
  readonly shouldAddToAbstractFileMenu: (params: AbstractFileCommandHandlerShouldAddToAbstractFileMenuParams) => boolean;
  readonly shouldAddToAbstractFilesMenu: (params: AbstractFileCommandHandlerShouldAddToAbstractFilesMenuParams) => boolean;
  readonly shouldAddToCommandPalette: () => boolean;
}

vi.mock('@mnaoumov/obsidian-lib/markdown', () => ({
  renderInternalLink: vi.fn().mockImplementation(() => Promise.resolve(createSpan()))
}));

let app: AppOriginal;
let bulkOperationRunnerStub: BulkOperationRunnerStub;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('BulkRenameCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createHandler(null);
    expect(handler.id).toBe('bulk-rename');
    expect(handler.name).toBe('Bulk rename...');
    expect(handler.icon).toBe('lucide-text-cursor-input');
  });

  it('should live on the multi-item menu only, not the single-item menu or the palette', () => {
    initApp({ 'a.md': '' });
    const { handler } = createHandler(null);
    expect(handler.shouldAddToAbstractFileMenu(castTo<AbstractFileCommandHandlerShouldAddToAbstractFileMenuParams>({}))).toBe(false);
    expect(handler.shouldAddToAbstractFilesMenu(castTo<AbstractFileCommandHandlerShouldAddToAbstractFilesMenuParams>({ abstractFiles: [] }))).toBe(true);
    expect(handler.shouldAddToCommandPalette()).toBe(false);
    expect(handler.canExecute()).toBe(false);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should be offered when one selected item can be renamed, never for the vault root alone', () => {
    initApp({ 'a.md': '' });
    const { handler } = createHandler(null);
    expect(handler.canExecuteAbstractFiles([app.vault.getRoot()])).toBe(false);
    expect(handler.canExecuteAbstractFiles([app.vault.getRoot(), get('a.md')])).toBe(true);
    expect(handler.canExecuteAbstractFile(get('a.md'))).toBe(true);
  });

  it('should not be offered where the command filter blocks it', () => {
    initApp({ 'a.md': '' });
    const { handler } = createHandler(null, { shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteAbstractFiles([get('a.md')])).toBe(false);
  });

  it('should do nothing when no selected item can be renamed', async () => {
    initApp();
    const { handler, selectOptions } = createHandler(null);
    await handler.executeAbstractFiles([app.vault.getRoot()]);
    expect(selectOptions).not.toHaveBeenCalled();
  });

  it('should do nothing when the dialog is cancelled', async () => {
    initApp({ 'p/a.md': '' });
    const { handler } = createHandler(null);
    await handler.executeAbstractFile(get('p/a.md'));
    expect(app.vault.getFileByPath('p/a.md')).not.toBeNull();
    expect(bulkOperationRunnerStub.summaries).toEqual([]);
  });

  it('should not rename a batch with a problem, or one that changes nothing', async () => {
    initApp({ 'p/a.md': '', 'p/taken.md': '' });
    const { handler } = createHandler({ findText: 'a', replaceText: 'taken' });
    await handler.executeAbstractFiles([get('p/a.md')]);
    expect(bulkOperationRunnerStub.summaries).toEqual([]);

    const { handler: unchangedHandler } = createHandler({});
    await unchangedHandler.executeAbstractFiles([get('p/a.md')]);
    expect(bulkOperationRunnerStub.summaries).toEqual([]);
  });

  it('should number the batch in explorer order, rename a folder with a file inside it, and let its folder note follow', async () => {
    initApp({
      'p/alpha.md': 'a',
      'p/Beta/Beta.md': 'note',
      'p/Beta/inner.md': 'inner',
      'p/README': 'no extension',
      'q/x.md': 'x'
    });
    const { handler, selectOptions, showNotice } = createHandler({ prefix: '{{index:00}}. ' });

    await handler.executeAbstractFiles([get('q/x.md'), get('p/Beta/inner.md'), get('p/alpha.md'), get('p/Beta'), get('p/README')]);

    const params = ensureNonNullable(selectOptions.mock.calls[0])[0];
    expect(params.buildPlan(DEFAULT_BULK_RENAME_REQUEST).entries.map((entry) => entry.oldPath)).toEqual([
      'p/Beta',
      'p/alpha.md',
      'p/README',
      'p/Beta/inner.md',
      'q/x.md'
    ]);
    expect(paths()).toEqual([
      'p/01. Beta/01. Beta.md',
      'p/01. Beta/04. inner.md',
      'p/02. alpha.md',
      'p/03. README',
      'q/05. x.md'
    ]);
    expect(bulkOperationRunnerStub.summaries).toEqual(['Bulk rename 5 item(s)']);
    expect(showNotice).toHaveBeenCalled();
  });

  it('should leave a folder note alone when the batch renames it itself', async () => {
    initApp({ 'p/Beta/Beta.md': 'note' });
    const { handler } = createHandler({ suffix: '2' });
    await handler.executeAbstractFiles([get('p/Beta'), get('p/Beta/Beta.md')]);
    expect(paths()).toEqual(['p/Beta2/Beta2.md']);
  });

  it('should leave a folder note with a fixed name where it is', async () => {
    initApp({ 'p/Beta/index.md': 'note' });
    const { handler } = createHandler({ suffix: '2' }, { folderNoteNameTemplate: 'index' });
    await handler.executeAbstractFiles([get('p/Beta')]);
    expect(paths()).toEqual(['p/Beta2/index.md']);
  });

  it('should rename a folder that has no folder note', async () => {
    initApp({ 'p/Beta/other.md': 'note' });
    const { handler } = createHandler({ suffix: '2' });
    await handler.executeAbstractFiles([get('p/Beta')]);
    expect(paths()).toEqual(['p/Beta2/other.md']);
  });

  it('should rename an item at the vault root, checking the root for a clash', async () => {
    initApp({ 'x.md': 'x', 'X2.md': 'taken', 'y.md': 'y' });
    const { handler } = createHandler({ suffix: '2' });
    await handler.executeAbstractFiles([get('x.md')]);
    expect(bulkOperationRunnerStub.summaries).toEqual([]);

    const { handler: secondHandler } = createHandler({ suffix: '2' });
    await secondHandler.executeAbstractFiles([get('y.md')]);
    expect(paths()).toEqual(['X2.md', 'x.md', 'y2.md']);
  });

  it('should swap two names through a temporary name', async () => {
    initApp({ 'p/ab.md': 'first', 'p/ba.md': 'second' });
    const { handler } = createHandler({ findText: '^(a|b)(a|b)$', isRegularExpression: true, replaceText: '$2$1' });
    await handler.executeAbstractFiles([get('p/ab.md'), get('p/ba.md')]);
    expect(paths()).toEqual(['p/ab.md', 'p/ba.md']);
    expect(await app.vault.read(ensureNonNullable(app.vault.getFileByPath('p/ba.md')))).toBe('first');
    expect(await app.vault.read(ensureNonNullable(app.vault.getFileByPath('p/ab.md')))).toBe('second');
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-rename', async () => {
    initApp({ 'p/a.md': 'a', 'p/b.md': 'b' });
    const { handler, showNotice } = createHandler({ suffix: '2' });
    let hasAborted = false;
    const originalRenameFile = app.fileManager.renameFile.bind(app.fileManager);
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (file, newPath) => {
      if (!hasAborted && file.path === 'p/b.md') {
        hasAborted = true;
        requestResourceUnlockForPath(app, 'p/b.md');
        throw new Error('Rename cancelled.');
      }
      await originalRenameFile(file, newPath);
    });

    await expect(handler.executeAbstractFiles([get('p/a.md'), get('p/b.md')])).resolves.toBeUndefined();
    expect(paths()).toEqual(['p/a.md', 'p/b.md']);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should roll back and rethrow an error that is not a cancellation', async () => {
    initApp({ 'p/a.md': 'a' });
    const { handler } = createHandler({ suffix: '2' });
    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('Disk on fire.'));
    await expect(handler.executeAbstractFiles([get('p/a.md')])).rejects.toThrow('Disk on fire.');
    expect(paths()).toEqual(['p/a.md']);
  });

  it('should park a cycle member under a free name that differs by more than case', () => {
    initApp({ 'p/a (renaming).md': '', 'p/f (renaming)/x.md': '' });
    const { handler } = createHandler(null);
    expect(handler.resolveTemporaryPath('p/A.md', false)).toBe('p/A (renaming).md');
    expect(handler.resolveTemporaryPath('p/a.md', false)).toBe('p/a (renaming) 1.md');
    expect(handler.resolveTemporaryPath('p/README', false)).toBe('p/README (renaming)');
    expect(handler.resolveTemporaryPath('p/f', true)).toBe('p/f (renaming) 1');
  });
});

function createHandler(options: null | Partial<BulkRenameRequest>, settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  bulkOperationRunnerStub = createBulkOperationRunnerStub();
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const selectOptions = vi.fn().mockImplementation((_params: SelectBulkRenameRequestParams): Promise<BulkRenameRequest | null> => Promise.resolve(options === null ? null : { ...DEFAULT_BULK_RENAME_REQUEST, ...options }));
  const handler = new BulkRenameCommandHandler({
    app,
    bulkOperationRunner: bulkOperationRunnerStub,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({
      showNotice: castTo<PluginNoticeComponent['showNotice']>(showNotice),
      showNoticeAfterDelay: createShowNoticeAfterDelayStub()
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        folderNoteLocation: FolderNoteLocation.InsideFolder,
        folderNoteNameTemplate: '{{folderName}}',
        shouldAddCommandsToSubmenu: true,
        shouldBlockCommandOnPath: () => false,
        shouldBlockVaultDuringOperations: false,
        shouldShowOperationNotices: true,
        ...settingsOverrides
      })
    }),
    resourceLockComponent,
    selectBulkRenameRequest: castTo<SelectBulkRenameRequest>(selectOptions)
  });
  return {
    handler: castTo<Testable>(handler),
    selectOptions: castTo<MockInstance<SelectBulkRenameRequest>>(selectOptions),
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}

function createShowNoticeAfterDelayStub(): PluginNoticeComponent['showNoticeAfterDelay'] {
  return vi.fn().mockImplementation((delayedNoticeParams: PluginNoticeComponentShowNoticeAfterDelayParams) => {
    invokeAsyncSafely(async () => {
      await castTo<() => Promise<unknown>>(delayedNoticeParams.content)();
    });
    return { setContent: vi.fn(), [Symbol.dispose]: vi.fn() };
  });
}

function get(path: string): TAbstractFile {
  return ensureNonNullable(app.vault.getAbstractFileByPath(path));
}

function initApp(files: Record<string, string> = {}): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

function paths(): string[] {
  return app.vault.getFiles().map((file) => file.path).sort();
}
