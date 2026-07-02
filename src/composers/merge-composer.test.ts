import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { TFile } from 'obsidian';

import { App } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  ensureNonNullable,
  type GenericObject
} from 'obsidian-dev-utils/type-guards';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { MergeComposer } from './merge-composer.ts';

interface AbortableComposer {
  readonly abortController: AbortController;
}

// Return-value stubs for metadata-cache reads only: test-mocks has no metadata indexer, so getCacheSafe
// Would otherwise poll forever. Everything else (vault, lock, transaction, links) is REAL (G49).
vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>(),
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
  getCacheSafe: vi.fn().mockResolvedValue(null),
  getFrontmatterSafe: vi.fn().mockResolvedValue({})
}));

// UI-rendering helpers used only by the composer's notices — stub their return so link rendering does not
// Reach into unmocked App internals (embedRegistry). Not the behavior under test.
vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

let app: App;
let resourceLockComponent: ResourceLockComponent;

beforeEach(() => {
  app = App.createConfigured__({
    files: {
      'source.md': 'source body',
      'target.md': 'target body'
    }
  }).asOriginalType__();
  // Test-mocks' MetadataCache is a strict proxy with no indexer; the merge's processFrontMatter
  // Triggers a recompute, so stub it to a no-op.
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
});

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function getSourceFile(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('source.md'));
}

function getTargetFile(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('target.md'));
}

function createComposer(settingsOverrides?: Partial<PluginSettings>): MergeComposer {
  return new MergeComposer({
    app,
    consoleDebugComponent: strictProxy({ consoleDebug: vi.fn() }),
    isNewTargetFile: false,
    pluginNoticeComponent: createPluginNoticeComponentStub(),
    pluginSettingsComponent: createPluginSettingsComponentStub(settingsOverrides),
    resourceLockComponent,
    sourceFile: getSourceFile(),
    targetFile: getTargetFile()
  });
}

function createPluginNoticeComponentStub(): PluginNoticeComponent {
  return strictProxy<PluginNoticeComponent>({
    showNotice: vi.fn(),
    showNoticeAfterDelay: vi.fn().mockReturnValue({ setContent: vi.fn(), [Symbol.dispose]: vi.fn() })
  });
}

function createPluginSettingsComponentStub(overrides?: Partial<PluginSettings>): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({
      defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      isPathIgnored: () => false,
      mergeTemplate: '{{content}}',
      shouldFixFootnotesByDefault: false,
      shouldMergeHeadingsByDefault: false,
      shouldOpenNoteAfterMerge: false,
      shouldRunTemplaterOnDestinationFile: false,
      ...overrides
    })
  });
}

describe('MergeComposer', () => {
  describe('mergeFile', () => {
    it('should merge the source content into the target and trash the source', async () => {
      await createComposer().mergeFile();

      // The transaction stages/commits deletions through app.vault.adapter, so assert via the adapter
      // (test-mocks does not sync the in-memory vault tree from adapter moves).
      expect(await app.vault.adapter.exists('source.md')).toBe(false);
      const targetContent = await app.vault.adapter.read('target.md');
      expect(targetContent).toContain('target body');
      expect(targetContent).toContain('source body');
    });

    it('should not touch the vault when the target path is ignored', async () => {
      await createComposer({ isPathIgnored: () => true }).mergeFile();

      expect(app.vault.getAbstractFileByPath('source.md')).not.toBeNull();
      expect(await app.vault.adapter.read('target.md')).toBe('target body');
    });

    it('should abort and not trash the source when a file is modified during the operation', async () => {
      const composer = createComposer();
      // Simulate an external edit to the source while the operation is in progress: bump its mtime
      // Between the mtime capture and the unchanged-check.
      vi.spyOn(app.vault, 'read').mockImplementation((file) => {
        ensureNonNullable(app.vault.getFileByPath('source.md')).stat.mtime += 1;
        return Promise.resolve(castTo<TFile>(file).path === 'source.md' ? 'source body' : 'target body');
      });

      await composer.mergeFile();

      expect(app.vault.getAbstractFileByPath('source.md')).not.toBeNull();
      expect(await app.vault.adapter.read('target.md')).toBe('target body');
    });

    it('should swallow the cancellation and roll back when aborted mid-operation', async () => {
      const composer = createComposer();
      // Simulate the user clicking the lock indicator's Unlock mid-operation.
      castTo<AbortableComposer>(composer).abortController.abort();

      await expect(composer.mergeFile()).resolves.toBeUndefined();

      // Rolled back: the source is untouched and the target is unchanged.
      expect(app.vault.getAbstractFileByPath('source.md')).not.toBeNull();
      expect(await app.vault.adapter.read('target.md')).toBe('target body');
    });
  });
});
