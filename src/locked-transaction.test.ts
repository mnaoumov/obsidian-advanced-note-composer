import type { App as AppOriginal } from 'obsidian';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
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

import { runLockedTransaction } from './locked-transaction.ts';

const NOTE_PATH = 'note.md';

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

beforeEach(() => {
  app = App.createConfigured__({ files: { [NOTE_PATH]: 'original' } }).asOriginalType__();
  // Indexing is not under test, and every vault write triggers it.
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  castTo<GenericObject>(app.metadataCache)['parseFileMetadata'] = vi.fn().mockReturnValue({});
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
});

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

async function readNote(): Promise<string> {
  return app.vault.read(ensureNonNullable(app.vault.getFileByPath(NOTE_PATH)));
}

describe('runLockedTransaction', () => {
  it('should commit a body that ran to the end', async () => {
    await runLockedTransaction({
      abortController: new AbortController(),
      app,
      body: async (vaultTransaction) => {
        await vaultTransaction.process(NOTE_PATH, () => 'changed');
      },
      lockTargets: [{ mode: 'file', pathOrFile: NOTE_PATH }],
      operationName: 'Test',
      resourceLockComponent
    });

    expect(await readNote()).toBe('changed');
  });

  it('should roll back a body that was cancelled mid-way, even though it never polled the signal (issue #289)', async () => {
    const abortController = new AbortController();

    await expect(runLockedTransaction({
      abortController,
      app,
      body: async (vaultTransaction) => {
        await vaultTransaction.process(NOTE_PATH, () => 'half-applied');
        // The user presses Cancel while the body is still running; the body carries on regardless.
        abortController.abort();
        await vaultTransaction.process(NOTE_PATH, () => 'fully applied');
      },
      lockTargets: [{ mode: 'file', pathOrFile: NOTE_PATH }],
      operationName: 'Test',
      resourceLockComponent
    })).rejects.toThrow();

    expect(await readNote()).toBe('original');
  });
});
