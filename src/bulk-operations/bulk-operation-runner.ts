import type { BulkOperationCommitComponent } from '@mnaoumov/obsidian-lib/components/bulk-operation-commit-component';

/**
 * What a bulk command needs from `@mnaoumov/obsidian-lib`'s `BulkOperationCommitComponent`: running its
 * operation between a `chore: before OP<n>` and an `OP<n>: <summary>` commit, so `git revert` undoes it.
 *
 * Narrowed to the one method so a command handler's tests can hand it a pass-through instead of the
 * component, and so a handler cannot reach the undo half, which belongs to its own command.
 */
export type BulkOperationRunner = Pick<BulkOperationCommitComponent, 'runBulkOperation'>;
