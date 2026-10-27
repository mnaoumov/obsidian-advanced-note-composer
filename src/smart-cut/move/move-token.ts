/**
 * Creates a unique token used by the move / same-note-split flow to mark the exact insert point in the
 * target note. The processed content later replaces this token by string match, so the insert point
 * survives the source-selection removal even when the target IS the source note.
 *
 * @returns A unique HTML-comment token.
 */
export function createMoveToken(): string {
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- crypto.randomUUID is a stable Web API in the Obsidian (Electron) runtime.
  return `<!--advanced-note-composer-move-${crypto.randomUUID()}-->`;
}
