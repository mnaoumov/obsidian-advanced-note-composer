import type {
  App,
  TAbstractFile,
  TFolder
} from 'obsidian';

import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';
import {
  basename,
  extname,
  join
} from 'obsidian-dev-utils/path';

/**
 * One direct child of the folder being flattened, as the confirmation dialog shows it: the name it has
 * today, and the name it will have once it is a sibling of the folder it came from.
 */
export interface FlattenPreviewRow {
  readonly name: string;
  readonly targetName: string;
}

interface BuildFlattenPreviewRowsParams {
  readonly app: App;
  readonly children: readonly TAbstractFile[];
  readonly parentFolder: TFolder;
}

interface ResolveTargetPathParams {
  readonly app: App;
  readonly child: TAbstractFile;
  readonly claimedPaths: ReadonlySet<string>;
  readonly parentFolder: TFolder;
}

/**
 * Computes what `Flatten folder...` will do to each direct child, for the confirmation dialog: the same
 * {@link getAvailablePath} de-duplication the flatten itself applies, so the preview cannot promise a name
 * the flatten will not give.
 *
 * The flatten renames the children one by one, so each rename can occupy a name the next child wanted. The
 * preview has no such vault state to read, so it tracks the names it has already handed out and skips past
 * them — which is what keeps two same-stemmed children (`a.md` and `a 1.md` both colliding with an
 * existing `a.md`) from being previewed as landing on the same name.
 *
 * @param params - The parameters.
 * @returns One row per direct child, in the order they will be moved.
 */
export function buildFlattenPreviewRows(params: BuildFlattenPreviewRowsParams): FlattenPreviewRow[] {
  const {
    app,
    children,
    parentFolder
  } = params;
  const claimedPaths = new Set<string>();
  const rows: FlattenPreviewRow[] = [];
  for (const child of children) {
    const targetPath = resolveTargetPath({
      app,
      child,
      claimedPaths,
      parentFolder
    });
    claimedPaths.add(targetPath);
    rows.push({ name: child.name, targetName: basename(targetPath) });
  }
  return rows;
}

/**
 * Resolves the path a single child will end up at, skipping the names earlier children already claimed.
 *
 * @param params - The parameters.
 * @returns The path the child will be moved to.
 */
function resolveTargetPath(params: ResolveTargetPathParams): string {
  const {
    app,
    child,
    claimedPaths,
    parentFolder
  } = params;
  let targetPath = getAvailablePath(app, join(parentFolder.path, child.name));
  const extension = extname(child.name);
  const stem = basename(child.name, extension);
  let counter = 1;
  while (claimedPaths.has(targetPath)) {
    targetPath = getAvailablePath(app, join(parentFolder.path, `${stem} ${String(counter)}${extension}`));
    counter++;
  }
  return targetPath;
}
