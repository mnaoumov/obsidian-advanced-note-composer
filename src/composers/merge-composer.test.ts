import type {
  App as AppOriginal,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
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

// Return-value stubs for the two metadata reads test-mocks does not fully model: the backlink index
// (getBacklinksForFileSafe) and frontmatter extraction (getFrontmatterSafe). getCacheSafe runs for
// REAL against test-mocks' synchronous indexer, so editLinks sees the target's links; the vault, lock,
// Transaction, and link rewriting are all real too.
vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>(),
  getBacklinksForFileSafe: vi.fn().mockResolvedValue(new Map()),
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

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

beforeEach(() => {
  app = App.createConfigured__({
    files: {
      'source.md': 'source body',
      'target.md': 'target body'
    }
  }).asOriginalType__();
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
});

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createComposer(settingsOverrides?: Partial<PluginSettings>, isNewTargetFile = false): MergeComposer {
  return new MergeComposer({
    app,
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    isNewTargetFile,
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
    showNoticeAfterDelay: vi.fn().mockImplementation((params: PluginNoticeComponentShowNoticeAfterDelayParams) => {
      // Invoke the lazy content builder so the progress-notice content is exercised (it would only run
      // In the real component after the delay elapses); fire-and-forget — its result is not under test.
      invokeAsyncSafely(async () => {
        await castTo<() => Promise<unknown>>(params.content)();
      });
      return { setContent: vi.fn(), [Symbol.dispose]: vi.fn() };
    })
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
      shouldUseSourceTitleWhenTargetHasNoTitle: false,
      ...overrides
    })
  });
}

function getSourceFile(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('source.md'));
}

function getTargetFile(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('target.md'));
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

    it('should keep the source title when merging into a brand-new target file (issue #114)', async () => {
      // A folder merge routes each non-colliding source note into a freshly created empty target file
      // (isNewTargetFile === true). The moved note's `title` must survive rather than being dropped.
      await app.vault.modify(getSourceFile(), '---\ntitle: Source Title\n---\nsource body');

      await createComposer(undefined, true).mergeFile();

      const targetContent = await app.vault.adapter.read('target.md');
      expect(targetContent).toContain('title: Source Title');
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

    it('should open the target note after the merge when the setting is enabled', async () => {
      const openFile = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(strictProxy<WorkspaceLeaf>({ openFile }));

      await createComposer({ shouldOpenNoteAfterMerge: true }).mergeFile();

      expect(openFile).toHaveBeenCalledWith(getTargetFile(), { active: true });
    });

    it('should rethrow when the merge fails for a reason other than cancellation', async () => {
      vi.spyOn(app.fileManager, 'processFrontMatter').mockRejectedValue(new Error('boom'));

      await expect(createComposer().mergeFile()).rejects.toThrow('boom');
    });

    it('should rewrite a target link that resolved to the merged-away source and leave others alone', async () => {
      // The target links to both the source and an unrelated note. After the merge folds the source
      // Into the target, the [[source]] backlink must be rewritten to the surviving target note, while
      // The [[other]] link (which does not resolve to the source) is left untouched.
      await app.vault.create('other.md', 'other body');
      await app.vault.modify(getTargetFile(), 'target body\n[[source]]\n[[other]]\n');
      // Link-format resolution (getNewLinkFormat / shouldUseWikilinks) reads Vault.getConfig, which
      // Test-mocks does not model; absolute format plus wikilinks emits a plain [[target]] wikilink.
      castTo<GenericObject>(app.vault)['getConfig'] = vi.fn((key: string) => {
        switch (key) {
          case 'newLinkFormat':
            return 'absolute';
          case 'useMarkdownLinks':
            return false;
          default:
            return undefined;
        }
      });

      await createComposer().mergeFile();

      const targetContent = await app.vault.adapter.read('target.md');
      expect(targetContent).toContain('[[target]]');
      expect(targetContent).not.toContain('[[source]]');
      expect(targetContent).toContain('[[other]]');
    });
  });
});
