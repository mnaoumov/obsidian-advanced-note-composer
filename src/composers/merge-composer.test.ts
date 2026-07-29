import type {
  App as AppOriginal,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type { GetAvailablePathForAttachmentsExtendedFnParams } from 'obsidian-dev-utils/obsidian/attachment-path';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { getPath } from 'obsidian-dev-utils/obsidian/file-system';
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
      markdownAttachmentSubExtensions: ['excalidraw'],
      mergeTemplate: '{{content}}',
      shouldFixFootnotesByDefault: false,
      shouldMergeHeadingsByDefault: false,
      shouldMoveAttachmentsWhenMergingFile: false,
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

    it('should NOT open the target note when shouldOpenAfterMerge is false, even if the setting is on (folder merge, issue #106)', async () => {
      // A folder merge passes shouldOpenAfterMerge: false so it does not open each merged note in turn
      // (the "visual cycling" of issue #106). The per-instance override must win over the enabled setting.
      const openFile = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(strictProxy<WorkspaceLeaf>({ openFile }));

      await new MergeComposer({
        app,
        consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
        isNewTargetFile: false,
        pluginNoticeComponent: createPluginNoticeComponentStub(),
        pluginSettingsComponent: createPluginSettingsComponentStub({ shouldOpenNoteAfterMerge: true }),
        resourceLockComponent,
        shouldOpenAfterMerge: false,
        sourceFile: getSourceFile(),
        targetFile: getTargetFile()
      }).mergeFile();

      expect(openFile).not.toHaveBeenCalled();
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

  describe('attachment relocation (issue #161)', () => {
    it('should move an attachment the source owns into the destination note\'s attachment folder', async () => {
      initAttachmentApp();

      await createAttachmentComposer().mergeFile();

      // Attachments live beside their note, and the note now lives in `Other`.
      expect(await app.vault.adapter.exists('Other/img.png')).toBe(true);
      expect(await app.vault.adapter.exists('Docs/img.png')).toBe(false);
      // The embed was rewritten by the vault's own rename before the content was merged.
      expect(await app.vault.adapter.read('Other/target.md')).toContain('img.png');
    });

    it('should leave the attachment where it is when the setting is off', async () => {
      initAttachmentApp();

      await createAttachmentComposer({ shouldMoveAttachmentsWhenMergingFile: false }).mergeFile();

      expect(await app.vault.adapter.exists('Docs/img.png')).toBe(true);
      expect(await app.vault.adapter.exists('Other/img.png')).toBe(false);
    });

    it('should leave an attachment another note also references', async () => {
      initAttachmentApp({ 'Docs/keeper.md': '![[img.png]]' });

      await createAttachmentComposer().mergeFile();

      expect(await app.vault.adapter.exists('Docs/img.png')).toBe(true);
      expect(await app.vault.adapter.exists('Other/img.png')).toBe(false);
    });

    it('should honor an attachment-location plugin\'s destination', async () => {
      // What issue #161 asked for: the destination comes from whatever patched Obsidian's attachment
      // Resolution (e.g. Custom Attachment Location), without this plugin knowing that plugin exists.
      initAttachmentApp({}, (notePath) => `Assets/${notePath.replace(/\.md$/, '')}`);

      await createAttachmentComposer().mergeFile();

      expect(await app.vault.adapter.exists('Assets/Other/target/img.png')).toBe(true);
      expect(await app.vault.adapter.exists('Docs/img.png')).toBe(false);
    });

    it('should put the attachment back when the merge is cancelled', async () => {
      initAttachmentApp();
      const composer = createAttachmentComposer();
      castTo<AbortableComposer>(composer).abortController.abort();

      await composer.mergeFile();

      expect(await app.vault.adapter.exists('Docs/img.png')).toBe(true);
      expect(await app.vault.adapter.exists('Other/img.png')).toBe(false);
      expect(await app.vault.adapter.exists('Docs/source.md')).toBe(true);
    });
  });
});

function createAttachmentComposer(settingsOverrides?: Partial<PluginSettings>): MergeComposer {
  return new MergeComposer({
    app,
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    isNewTargetFile: false,
    pluginNoticeComponent: createPluginNoticeComponentStub(),
    pluginSettingsComponent: createPluginSettingsComponentStub({ shouldMoveAttachmentsWhenMergingFile: true, ...settingsOverrides }),
    resourceLockComponent,
    sourceFile: ensureNonNullable(app.vault.getFileByPath('Docs/source.md')),
    targetFile: ensureNonNullable(app.vault.getFileByPath('Other/target.md'))
  });
}

function initAttachmentApp(extraFiles: Record<string, string> = {}, resolveAttachmentFolderPathForNote?: (notePath: string) => string): void {
  resourceLockComponent.unload();
  app = App.createConfigured__({
    files: {
      'Docs/img.png': 'PIC',
      'Docs/source.md': '![[img.png]]',
      'Other/target.md': 'target body',
      ...extraFiles
    }
  }).asOriginalType__();
  // Attachments live beside their note unless a plugin says otherwise, so the merge has to move the
  // Image out of `Docs` and into `Other`.
  app.vault.setConfig('attachmentFolderPath', './');
  // The link settings the rewriting behind a moved attachment reads carry no modeled default; absolute
  // Wikilinks are the deterministic choice, since `shortest` would depend on the rest of the fixture vault.
  app.vault.setConfig('newLinkFormat', 'absolute');
  app.vault.setConfig('useMarkdownLinks', false);
  if (resolveAttachmentFolderPathForNote) {
    stubAttachmentLocationPlugin(resolveAttachmentFolderPathForNote);
  }
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

/**
 * Models an attachment-location plugin (e.g. Custom Attachment Location): the `extended` member it installs
 * on Obsidian's `getAvailablePathForAttachments` is what `obsidian-dev-utils` dispatches to instead of the
 * native resolution. This is the only way a note gets an attachment folder OF ITS OWN — every native mode
 * resolves the same folder for every note in a folder.
 *
 * @param resolveAttachmentFolderPathForNote - Maps a note's path to the folder its attachments belong in.
 */
function stubAttachmentLocationPlugin(resolveAttachmentFolderPathForNote: (notePath: string) => string): void {
  function extended(params: GetAvailablePathForAttachmentsExtendedFnParams): Promise<string> {
    // A real attachment-location plugin also handles a note-less resolution; these tests never ask for one,
    // So fail loudly rather than invent a fallback folder.
    const notePath = getPath(app, ensureNonNullable(params.notePathOrFile));
    const folderPath = resolveAttachmentFolderPathForNote(notePath);
    const basePath = folderPath === '' ? params.attachmentFileBaseName : `${folderPath}/${params.attachmentFileBaseName}`;
    return Promise.resolve(
      params.shouldSkipDuplicateCheck
        ? `${basePath}.${params.attachmentFileExtension}`
        : app.vault.getAvailablePath(basePath, params.attachmentFileExtension)
    );
  }

  app.vault.getAvailablePathForAttachments = castTo<typeof app.vault.getAvailablePathForAttachments>(Object.assign(vi.fn(), { extended }));
}
