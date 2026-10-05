import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

/**
 * The plugin id Advanced Metadata Cache publishes its API under. Spelled out rather than imported, since the
 * closure cannot reach an import and the test should fail if the production constant drifts from it.
 */
const ADVANCED_METADATA_CACHE_PLUGIN_ID = 'advanced-metadata-cache';

interface HeadingTimesLike {
  created: null | number;
  heading: string;
  level: number;
  line: number;
  modified: null | number;
  seen: null | number;
}

interface ObsidianDevUtilsStateLike {
  pluginApiRegistry?: PluginApiRegistryWrapperLike;
}

/**
 * The slice of the `obsidian-dev-utils` cross-plugin registry the stand-in is published into.
 */
interface PluginApiRegistryHostLike {
  __obsidianDevUtils?: ObsidianDevUtilsStateLike;
}

interface PluginApiRegistryLike {
  records?: Record<string, PublishedPluginApiRecordLike[]>;
  subscribers?: (() => void)[];
}

interface PluginApiRegistryWrapperLike {
  value?: PluginApiRegistryLike;
}

interface PublishedPluginApiRecordLike {
  api: object;
  apiVersion: string;
  contract: Record<string, object>;
  isRevoked: boolean;
  pluginId: string;
}

describe('reorder headings: sort (issue #306)', () => {
  it('should sort a changelog newest first through the modal\'s sort row, carrying each version\'s content', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Five waits share the transport's 30 s cap, each a fast modal or one-note step.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 4000;

        const file = await resetFile(
          'reorder-headings-sort.md',
          '# Changelog\n\n## 1.9.0\nnine\n\n### Fixed\nf9\n\n## 1.10.0\nten\n\n## 1.2.0\ntwo\n'
        );
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'editor did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        await waitUntil({
          message: 'heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 5,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'sort row did not render',
          predicate: () => getRowLabels().length === 5 && document.querySelector('.advanced-note-composer-reorder-sort-scope') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const scopeEl = document.querySelector('.advanced-note-composer-reorder-sort-scope');
        if (!(scopeEl instanceof HTMLSelectElement)) {
          throw new TypeError('No sort scope dropdown.');
        }
        const defaultScope = scopeEl.value;
        const scopes = [...scopeEl.options].map((option) => option.text);
        const keyEl = document.querySelector('.advanced-note-composer-reorder-sort-key');
        if (!(keyEl instanceof HTMLSelectElement)) {
          throw new TypeError('No sort key dropdown.');
        }
        // Nothing publishes heading times here, so the time keys are offered disabled.
        const keys = [...keyEl.options].map((option) => ({ isDisabled: option.disabled, text: option.text }));

        clickButton('.advanced-note-composer-reorder-sort-descending');
        await waitUntil({
          message: 'rows were not sorted',
          predicate: () => getRowLabels()[1] === '1.10.0',
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const sortedRows = getRowLabels();

        clickButton('.modal-button-container button.mod-cta');
        await waitUntil({
          message: 'note was not reordered',
          predicate: async () => {
            const content = await app.vault.read(file);
            return content.indexOf('## 1.10.0') < content.indexOf('## 1.9.0');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        return { defaultScope, keys, note: await app.vault.read(file), scopes, sortedRows };

        function clickButton(selector: string): void {
          const button = document.querySelector(selector);
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError(`No button matching ${selector}.`);
          }
          button.click();
        }

        function getRowLabels(): string[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')].map((itemEl) => itemEl.dataset['rowLabel'] ?? '');
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The lone title heading is skipped: the dropdown starts on the versions under it.
    expect(result.defaultScope).toBe('2');
    expect(result.scopes).toEqual(['Level 2 (##)', 'All levels']);
    const unavailable = '(needs Advanced Metadata Cache with its Headings module on)';
    expect(result.keys).toEqual([
      { isDisabled: false, text: 'Name' },
      { isDisabled: true, text: `Created time ${unavailable}` },
      { isDisabled: true, text: `Modified time ${unavailable}` },
      { isDisabled: true, text: `Recently seen ${unavailable}` }
    ]);
    expect(result.sortedRows).toEqual(['Changelog', '1.10.0', '1.9.0', 'Fixed', '1.2.0']);
    expect(result.note).toBe('# Changelog\n\n## 1.10.0\nten\n\n## 1.9.0\nnine\n\n### Fixed\nf9\n\n## 1.2.0\ntwo\n');
  });

  it('should sort by the created time Advanced Metadata Cache publishes, newest first', async () => {
    const result = await evalInObsidian({
      async callback({ advancedMetadataCachePluginId, app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Five waits share the transport's 30 s cap, each a fast modal or one-note step.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 4000;
        // When each heading was created, by its text. `Old` was there before tracking began, so it has none.
        const CREATED_BY_HEADING: Record<string, null | number> = { Fresh: 3000, Log: 0, Middle: 2000, Old: null };

        const host = window as PluginApiRegistryHostLike;
        host.__obsidianDevUtils ??= {};
        host.__obsidianDevUtils.pluginApiRegistry ??= {};
        const registryWrapper = host.__obsidianDevUtils.pluginApiRegistry;
        registryWrapper.value ??= {};
        const registry = registryWrapper.value;
        registry.records ??= {};
        const records = registry.records;

        // The stand-in answers from the live cache, as the real module does, under the contract version that
        // introduced the member, so a sort proves this plugin found it through the registry.
        const standInRecord: PublishedPluginApiRecordLike = {
          api: {
            getHeadingTimes(pathOrFile: string | TFile): HeadingTimesLike[] {
              const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path;
              const file = app.vault.getFileByPath(path);
              const headings = file ? app.metadataCache.getFileCache(file)?.headings ?? [] : [];
              return headings.map((heading) => ({
                created: CREATED_BY_HEADING[heading.heading] ?? null,
                heading: heading.heading,
                level: heading.level,
                line: heading.position.start.line,
                modified: null,
                seen: null
              }));
            }
          },
          apiVersion: '1.2.0',
          contract: { getHeadingTimes: {} },
          isRevoked: false,
          pluginId: advancedMetadataCachePluginId
        };
        records[advancedMetadataCachePluginId] = [...(records[advancedMetadataCachePluginId] ?? []), standInRecord];
        notifyRegistrySubscribers();

        try {
          const file = await resetFile('reorder-headings-sort-by-time.md', '# Log\n\n## Middle\nm\n\n## Old\no\n\n## Fresh\nf\n');
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: 'editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: 'heading cache not ready',
            predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 4,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          app.commands.executeCommandById(`${pluginId}:reorder-headings`);
          await waitUntil({
            message: 'sort row did not render',
            predicate: () => getRowLabels().length === 4 && document.querySelector('.advanced-note-composer-reorder-sort-key') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const keyEl = document.querySelector('.advanced-note-composer-reorder-sort-key');
          if (!(keyEl instanceof HTMLSelectElement)) {
            throw new TypeError('No sort key dropdown.');
          }
          const disabledKeys = [...keyEl.options].filter((option) => option.disabled).map((option) => option.value);
          keyEl.value = 'created';
          keyEl.dispatchEvent(new Event('change'));
          const buttonLabels = [...document.querySelectorAll<HTMLButtonElement>('.advanced-note-composer-reorder-sort button')].map((button) => button.textContent);

          clickButton('.advanced-note-composer-reorder-sort-descending');
          await waitUntil({
            message: 'rows were not sorted',
            predicate: () => getRowLabels()[1] === 'Fresh',
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const sortedRows = getRowLabels();

          clickButton('.modal-button-container button.mod-cta');
          await waitUntil({
            message: 'note was not reordered',
            predicate: async () => {
              const content = await app.vault.read(file);
              return content.startsWith('# Log\n\n## Fresh');
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          return { buttonLabels, disabledKeys, note: await app.vault.read(file), sortedRows };
        } finally {
          revokeStandIn();
        }

        function clickButton(selector: string): void {
          const button = document.querySelector(selector);
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError(`No button matching ${selector}.`);
          }
          button.click();
        }

        function getRowLabels(): string[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')].map((itemEl) => itemEl.dataset['rowLabel'] ?? '');
        }

        // A function rather than inline in the `finally`, whose earlier `await`s would otherwise make the
        // revocation look like a stale write. Revoked and dropped, as `publishPluginApi` does when its provider
        // unloads.
        function revokeStandIn(): void {
          standInRecord.isRevoked = true;
          records[advancedMetadataCachePluginId] = (records[advancedMetadataCachePluginId] ?? []).filter((record) => record !== standInRecord);
          notifyRegistrySubscribers();
        }

        function notifyRegistrySubscribers(): void {
          for (const subscriber of registry.subscribers ?? []) {
            subscriber();
          }
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      input: { advancedMetadataCachePluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.disabledKeys).toEqual([]);
    expect(result.buttonLabels).toEqual(['Oldest first', 'Newest first']);
    // `Old` has no created time, so it counts as the oldest and goes last.
    expect(result.sortedRows).toEqual(['Log', 'Fresh', 'Middle', 'Old']);
    expect(result.note).toBe('# Log\n\n## Fresh\nf\n\n## Middle\nm\n\n## Old\no\n');
  });
});
