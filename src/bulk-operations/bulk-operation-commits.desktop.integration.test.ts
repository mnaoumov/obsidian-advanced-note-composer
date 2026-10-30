import { execFileSync } from 'node:child_process';
import {
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

/*
 * Bulk-operation commits (`shouldCommitBulkOperations`) against a real git repository: a folder-wide command
 * run in Obsidian lands as `chore: before OP<n>` plus `OP<n>: <summary>`, and reverting that commit puts the
 * vault back. The harness vault is not a repository, so this suite makes it one for its own length and
 * removes the `.git` folder afterwards; Obsidian never indexes dot-folders, so no other suite sees it.
 */
const PLUGIN_ID = 'advanced-note-composer';
const POLL_INTERVAL_IN_MILLISECONDS = 250;
const COMMIT_TIMEOUT_IN_MILLISECONDS = 25_000;

interface BulkCommitSettings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAskBeforeFlattening: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldCommitBulkOperations: boolean;
}

interface ComponentTreeNode {
  readonly _children?: ComponentTreeNode[];
  readonly editAndSave?: unknown;
  readonly settings?: BulkCommitSettings;
}

interface SetSettingsInput {
  readonly pluginId: string;
  readonly shouldAskBeforeFlattening: boolean;
  readonly shouldCommitBulkOperations: boolean;
}

interface SettingsCarrier {
  readonly editAndSave: (editor: (settings: BulkCommitSettings) => void) => Promise<void>;
  readonly settings: BulkCommitSettings;
}

const vaultPath = getTemporaryVault().path;

function git(...arguments_: string[]): string {
  return execFileSync('git', arguments_, { cwd: vaultPath, encoding: 'utf-8' }).trim();
}

async function setSettings(input: SetSettingsInput): Promise<void> {
  await evalInObsidian({
    async callback({ app, isAskingBeforeFlattening, isCommitting, pluginId }) {
      const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
      const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node) {
          continue;
        }
        if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldCommitBulkOperations === 'boolean') {
          await (node as SettingsCarrier).editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = isAskingBeforeFlattening;
            settings.shouldCommitBulkOperations = isCommitting;
          });
          return;
        }
        queue.push(...node._children ?? []);
      }
      throw new Error('Settings component was not found.');
    },
    input: {
      isAskingBeforeFlattening: input.shouldAskBeforeFlattening,
      isCommitting: input.shouldCommitBulkOperations,
      pluginId: input.pluginId
    },
    vaultPath
  });
}

async function waitForGit(description: string, isDone: () => boolean): Promise<void> {
  const deadline = Date.now() + COMMIT_TIMEOUT_IN_MILLISECONDS;
  while (!isDone()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}. git log:\n${git('log', '--format=%s')}`);
    }
    await sleep(POLL_INTERVAL_IN_MILLISECONDS);
  }
}

describe('bulk-operation commits', () => {
  beforeAll(() => {
    git('init', '--quiet');
    git('config', 'user.name', 'Integration Test');
    git('config', 'user.email', 'integration-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    // Dot-folders hold the app's own state and the trash, which change on every click and are not what the
    // suite is about.
    writeFileSync(join(vaultPath, '.gitignore'), '.*/\n');
  });

  afterAll(async () => {
    await setSettings({ pluginId: PLUGIN_ID, shouldAskBeforeFlattening: true, shouldCommitBulkOperations: false });
    rmSync(join(vaultPath, '.git'), { force: true, recursive: true });
    rmSync(join(vaultPath, '.gitignore'), { force: true });
  });

  it('records a flatten as two commits, and a revert of the second brings the folder back', async () => {
    await setSettings({ pluginId: PLUGIN_ID, shouldAskBeforeFlattening: false, shouldCommitBulkOperations: true });

    await evalInObsidian({
      async callback({ app, lib: { waitUntil } }) {
        await app.vault.createFolder('bulk-src');
        await app.vault.create('bulk-src/alpha.md', 'alpha body');
        await app.vault.create('bulk-src/beta.md', 'beta body');
        await waitUntil({ message: 'notes not indexed', predicate: () => app.vault.getAbstractFileByPath('bulk-src/beta.md') !== null });
      },
      vaultPath
    });
    git('add', '-A');
    git('commit', '--quiet', '-m', 'baseline');

    await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Pending before the command, so it lands in `chore: before OP<n>` rather than in the operation's commit.
        await app.vault.create('pending.md', 'pending body');
        const alpha = app.vault.getFileByPath('bulk-src/alpha.md');
        if (!alpha) {
          throw new Error('bulk-src/alpha.md is missing.');
        }
        await app.workspace.getLeaf(false).openFile(alpha);
        await waitUntil({
          message: 'alpha did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === 'bulk-src/alpha.md'
        });
        if (!app.commands.executeCommandById(`${pluginId}:flatten-folder`)) {
          throw new Error('Flatten folder... was not offered.');
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath
    });

    await waitForGit('the OP commit', () => git('log', '-1', '--format=%s').startsWith('OP'));

    const subjects = git('log', '--format=%s').split('\n');
    expect(subjects).toEqual(['OP1: Flatten folder bulk-src into /', 'chore: before OP1', 'baseline']);
    expect(git('show', '--name-only', '--format=', 'HEAD~1')).toBe('pending.md');
    const operationFiles = git('show', '--name-status', '--format=', 'HEAD').split('\n').sort();
    expect(operationFiles).toEqual([
      'R100\tbulk-src/alpha.md\talpha.md',
      'R100\tbulk-src/beta.md\tbeta.md'
    ]);
    expect(git('show', '-s', '--format=%b', 'HEAD')).toContain(`Obsidian-Plugin: ${PLUGIN_ID}`);

    git('revert', '--no-edit', 'HEAD');

    const state = await evalInObsidian({
      async callback({ app, lib: { waitUntil } }) {
        await waitUntil({
          message: 'the revert did not reach the vault',
          predicate: () => app.vault.getAbstractFileByPath('bulk-src/alpha.md') !== null && app.vault.getAbstractFileByPath('alpha.md') === null
        });
        return {
          alpha: await app.vault.adapter.read('bulk-src/alpha.md'),
          beta: await app.vault.adapter.read('bulk-src/beta.md'),
          isBetaGoneFromRoot: !(await app.vault.adapter.exists('beta.md')),
          isPendingKept: await app.vault.adapter.exists('pending.md')
        };
      },
      vaultPath
    });

    expect(state).toEqual({ alpha: 'alpha body', beta: 'beta body', isBetaGoneFromRoot: true, isPendingKept: true });
    expect(git('status', '--porcelain')).toBe('');
  });
});
