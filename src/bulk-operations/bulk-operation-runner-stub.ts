import type { BulkOperationCommitComponentRunBulkOperationParams } from '@mnaoumov/obsidian-lib/components/bulk-operation-commit-component';

import type { BulkOperationRunner } from './bulk-operation-runner.ts';

/**
 * A {@link BulkOperationRunner} that runs each operation directly, the way the real component does while
 * bulk-operation commits are off, and remembers the summary each one would have been committed under.
 */
export interface BulkOperationRunnerStub extends BulkOperationRunner {
  /**
   * The summary of every operation run so far, oldest first.
   */
  readonly summaries: readonly string[];
}

/**
 * Creates a {@link BulkOperationRunnerStub} for a command handler's unit tests.
 *
 * @returns The stub.
 */
export function createBulkOperationRunnerStub(): BulkOperationRunnerStub {
  const summaries: string[] = [];
  return {
    async runBulkOperation<T>(params: BulkOperationCommitComponentRunBulkOperationParams<T>): Promise<T> {
      summaries.push(params.summary);
      return await params.operation();
    },
    summaries
  };
}
