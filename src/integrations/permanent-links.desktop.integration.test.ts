import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PermanentLinksApi } from './permanent-links-api/api.d.ts';

interface ApiRecord {
  readonly api: Pick<PermanentLinksApi, 'moveKeys'>;
  readonly apiVersion: string;
  readonly contract: Record<string, object>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  isRevoked: boolean;
  readonly pluginId: string;
}

interface ApiRegistry {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  records?: Record<string, ApiRecord[]>;
}

interface ComponentNode {
  readonly _children?: ComponentNode[];
  readonly editAndSave?: unknown;
  readonly settings?: MergeSettings;
}

interface MergeSettings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  defaultFrontmatterMergeStrategy: string;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAskBeforeMerging: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldOpenNoteAfterMerge: boolean;
}

interface PermanentFrontmatter {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  permanentLinks?: string[];
}

interface RegistryHost {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  __obsidianLib?: RegistryState;
}

interface RegistryState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  pluginApiRegistry?: RegistryWrapper;
}

interface RegistryWrapper {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  value?: ApiRegistry;
}

interface SettingsCarrier {
  readonly editAndSave: (editor: (settings: MergeSettings) => void) => Promise<void>;
  readonly settings: MergeSettings;
}

// Desktop-only, matching the existing merge/delete suites. The provider stand-in uses the published
// registry protocol, so the built consumer still negotiates its API and awaits real frontmatter writes.
describe('Permanent Links in a note merge', () => {
  it('keeps destination keys first and carries every source alias when replacing frontmatter through the merge command', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        // Four waits share 16 seconds, below the transport cap, including metadata readiness.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 4000;
        const plugin = app.plugins.getPlugin(pluginId) as ComponentNode | null;
        const queue = plugin ? [plugin] : [];
        let settingsComponent: SettingsCarrier | undefined;
        while (queue.length > 0) {
          const node = queue.shift();
          if (!node) {
            continue;
          }
          if (typeof node.editAndSave === 'function' && node.settings) {
            settingsComponent = node as SettingsCarrier;
            break;
          }
          queue.push(...node._children ?? []);
        }
        if (!settingsComponent) {
          throw new Error('Settings component not found.');
        }
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const isOriginalShouldOpen = settingsComponent.settings.shouldOpenNoteAfterMerge;
        const originalStrategy = settingsComponent.settings.defaultFrontmatterMergeStrategy;
        const host = window as RegistryHost;
        host.__obsidianLib ??= {};
        host.__obsidianLib.pluginApiRegistry ??= {};
        host.__obsidianLib.pluginApiRegistry.value ??= {};
        const registry = host.__obsidianLib.pluginApiRegistry.value;
        registry.records ??= {};
        const records = registry.records;
        const previousRecords = records['permanent-links'];
        let wasSourceLiveDuringTransfer = false;
        let didTransferFinish = false;
        const source = await app.vault.create('permanent-source.md', '---\npermanentLinks: [source-key, source-alias]\n---\nsource body');
        const target = await app.vault.create('permanent-target.md', '---\npermanentLinks: [target-key, target-alias]\ntargetOnly: original\n---\ntarget body');
        const record: ApiRecord = {
          api: {
            async moveKeys(fromFile, toFile) {
              wasSourceLiveDuringTransfer = app.vault.getFileByPath(fromFile.path) === source;
              if (fromFile !== source || toFile !== target) {
                throw new Error('Unexpected transfer files.');
              }
              await app.fileManager.processFrontMatter(toFile, (frontmatter: PermanentFrontmatter) => {
                frontmatter.permanentLinks = ['target-key', 'target-alias', 'source-key', 'source-alias'];
              });
              await app.fileManager.processFrontMatter(fromFile, (frontmatter: PermanentFrontmatter) => {
                delete frontmatter.permanentLinks;
              });
              didTransferFinish = true;
            }
          },
          apiVersion: '1.1.0',
          contract: { moveKeys: {} },
          isRevoked: false,
          pluginId: 'permanent-links'
        };
        records['permanent-links'] = [record];
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultFrontmatterMergeStrategy = 'ReplaceWithNewFrontmatter';
            settings.shouldAskBeforeMerging = false;
            settings.shouldOpenNoteAfterMerge = false;
          });
          await app.workspace.getLeaf(false).openFile(source);
          await waitUntil({
            message: 'Source editor and metadata did not become ready',
            predicate: () => app.workspace.getActiveFile() === source && app.metadataCache.getFileCache(target)?.frontmatter !== undefined,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({
            message: 'Merge picker did not open',
            predicate: () => document.querySelector('.prompt-input') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge picker input.');
          }
          input.value = 'permanent-target';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'Target suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((item) => item.textContent.includes('permanent-target')),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          input.focus();
          await pressKey({ key: 'Enter' });
          await waitUntil({
            message: 'Source was not merged away',
            predicate: () => app.vault.getFileByPath(source.path) === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const content = await app.vault.read(target);
          const frontmatter = obsidianModule.parseYaml(obsidianModule.getFrontMatterInfo(content).frontmatter) as PermanentFrontmatter;
          return { content, didTransferFinish, keys: frontmatter.permanentLinks, wasSourceLiveDuringTransfer };
        } finally {
          record.isRevoked = true;
          if (previousRecords) {
            records['permanent-links'] = previousRecords;
          } else {
            delete records['permanent-links'];
          }
          await settingsComponent.editAndSave((settings) => {
            settings.defaultFrontmatterMergeStrategy = originalStrategy;
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
            settings.shouldOpenNoteAfterMerge = isOriginalShouldOpen;
          });
        }
      },
      input: { pluginId: 'advanced-note-composer' },
      vaultPath: getTemporaryVault().path
    });

    expect(result.didTransferFinish).toBe(true);
    expect(result.wasSourceLiveDuringTransfer).toBe(true);
    expect(result.keys).toEqual(['target-key', 'target-alias', 'source-key', 'source-alias']);
    expect(result.content).toContain('source body');
    expect(result.content).toContain('target body');
    expect(result.content).not.toContain('targetOnly');
  });
});
