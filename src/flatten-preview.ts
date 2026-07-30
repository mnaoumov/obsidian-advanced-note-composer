import type {
  App,
  TAbstractFile,
  TFolder
} from 'obsidian';

import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import {
  basename,
  extname,
  join
} from 'obsidian-dev-utils/path';

import { getAvailablePathForAbstractFile } from './available-folder-path.ts';

/**
 * One item the flatten will move, as the confirmation dialog shows it: the name it goes by today, and the
 * name it will have once it is a sibling of the folder it came from.
 */
export interface FlattenPreviewRow {
  /**
   * Whether the item has to be de-duplicated against an existing sibling, so the dialog shows the
   * `old → new` arrow. Not derivable from {@link name} vs {@link targetName}: `name` is a path relative to
   * the flattened folder, so a nested item's two fields differ even when nothing is renamed.
   */
  readonly isRenamed: boolean;
  readonly name: string;
  readonly targetName: string;
}

interface BuildFlattenPreviewRowsParams {
  readonly app: App;
  readonly children: readonly TAbstractFile[];
  readonly folder: TFolder;
  readonly parentFolder: TFolder;
}

interface ResolveTargetPathParams {
  readonly app: App;
  readonly child: TAbstractFile;
  readonly claimedPaths: ReadonlySet<string>;
  readonly parentFolder: TFolder;
}

/**
 * Computes what `Flatten folder...` will do to each item it moves, for the confirmation dialog: the same
 * de-duplication the flatten itself applies, so the preview cannot promise a name the flatten will not
 * give.
 *
 * The flatten renames the items one by one, so each rename can occupy a name the next item wanted. The
 * preview has no such vault state to read, so it tracks the names it has already handed out and skips past
 * them — which is what keeps two same-stemmed children (`a.md` and `a 1.md` both colliding with an
 * existing `a.md`) from being previewed as landing on the same name.
 *
 * A row's `name` is the item's path RELATIVE to the folder being flattened. For a direct child that is
 * just its name; under the recursive flatten mode it is what tells two promoted folders that share a base
 * name (`b/x` and `y/x`) apart.
 *
 * @param params - The parameters.
 * @returns One row per moved item, in the order they will be moved.
 */
export function buildFlattenPreviewRows(params: BuildFlattenPreviewRowsParams): FlattenPreviewRow[] {
  const {
    app,
    children,
    folder,
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
    const targetName = basename(targetPath);
    rows.push({
      isRenamed: targetName !== child.name,
      name: toRelativeName(child, folder),
      targetName
    });
  }
  return rows;
}

/**
 * Resolves the path a single item will end up at, skipping the names earlier items already claimed.
 *
 * @param params - The parameters.
 * @returns The path the item will be moved to.
 */
function resolveTargetPath(params: ResolveTargetPathParams): string {
  const {
    app,
    child,
    claimedPaths,
    parentFolder
  } = params;
  let targetPath = getAvailablePathForAbstractFile(app, child, join(parentFolder.path, child.name));
  // A folder has no extension, so its counter goes at the end of the whole name — otherwise a folder
  // Called `v1.2` would be de-duplicated as if `.2` were an extension.
  const extension = isFolder(child) ? '' : extname(child.name);
  const stem = extension ? basename(child.name, extension) : child.name;
  let counter = 1;
  while (claimedPaths.has(targetPath)) {
    targetPath = getAvailablePathForAbstractFile(app, child, join(parentFolder.path, `${stem} ${String(counter)}${extension}`));
    counter++;
  }
  return targetPath;
}

function toRelativeName(child: TAbstractFile, folder: TFolder): string {
  const prefix = `${folder.path}/`;
  /* v8 ignore next -- every previewed item comes from `collectFlattenItems`, so it is always under the folder. */
  return child.path.startsWith(prefix) ? child.path.slice(prefix.length) : child.name;
}
