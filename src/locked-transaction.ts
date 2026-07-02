import type { App } from 'obsidian';
import type { PathOrFile } from 'obsidian-dev-utils/obsidian/file-system';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

/**
 * A resource to lock for the duration of an operation.
 */
export interface LockTarget {
  /**
   * `'file'` locks a single file; `'subtree'` locks a folder and everything under it.
   */
  readonly mode: 'file' | 'subtree';

  /**
   * The file or folder to lock. Lock a folder subtree by its path (`folder.path`), since a folder is
   * not a {@link PathOrFile}.
   */
  readonly pathOrFile: PathOrFile;
}

/**
 * Parameters for {@link runLockedTransaction}.
 */
export interface RunLockedTransactionParams {
  /**
   * The {@link AbortController} shared with the locks: aborting it (via an intruder change or the
   * lock indicator's Unlock) cancels the operation and triggers rollback.
   */
  readonly abortController: AbortController;

  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The mutations to perform, routed through the {@link VaultTransaction} so they can be rolled back.
   */
  body(vaultTransaction: VaultTransaction): Promise<void>;

  /**
   * An outer transaction to run the mutations against (e.g. a folder merge spanning many files). When
   * provided, the body runs against it and this function does NOT lock, commit, or roll back — the outer
   * owner does.
   */
  readonly injectedVaultTransaction?: null | VaultTransaction;

  /**
   * The resources to lock (against edit/delete/rename/move) for the duration of the operation.
   */
  readonly lockTargets: readonly LockTarget[];

  /**
   * The per-plugin resource-lock component (from `PluginBase.resourceLockComponent`).
   */
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Runs {@link RunLockedTransactionParams.body} with every {@link RunLockedTransactionParams.lockTargets}
 * resource locked against edit/delete/rename/move (`shouldBlockMutations`) and its vault mutations
 * wrapped in a reversible {@link VaultTransaction}. The transaction's own writes pass the mutation
 * blocker via an ambient `bypassBlockedMutations` scope over the locked paths. On success the
 * transaction commits; on abort (external change or user cancel) or any thrown error it rolls back to
 * the original state; the locks are always released.
 *
 * When an outer transaction was injected (a spanning folder merge), the body runs against it and this
 * function neither locks nor commits/rolls back — the outer owner does.
 *
 * @param params - The lock targets, the mutation body, and the shared app/lock/abort context.
 * @returns A {@link Promise} that resolves when the body has run and the transaction committed.
 */
export async function runLockedTransaction(params: RunLockedTransactionParams): Promise<void> {
  if (params.injectedVaultTransaction) {
    await params.body(params.injectedVaultTransaction);
    return;
  }

  const lockedPathsOrFiles = params.lockTargets.map((lockTarget) => lockTarget.pathOrFile);
  const lockDisposables: Disposable[] = [];
  for (const lockTarget of params.lockTargets) {
    lockDisposables.push(params.resourceLockComponent.lockForPath(lockTarget.pathOrFile, {
      abortController: params.abortController,
      mode: lockTarget.mode,
      shouldBlockMutations: true
    }));
  }

  const vaultTransaction = new VaultTransaction({
    app: params.app,
    openMutationBypass: (): Disposable => params.resourceLockComponent.bypassBlockedMutations(lockedPathsOrFiles)
  });

  try {
    await params.body(vaultTransaction);
    await vaultTransaction.commit();
  } catch (error) {
    await vaultTransaction.rollback();
    throw error;
  } finally {
    for (const lockDisposable of lockDisposables) {
      lockDisposable[Symbol.dispose]();
    }
  }
}
