import { normalizePath } from 'obsidian';
import { join } from 'obsidian-dev-utils/path';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import { parseNumberedName } from './numbered-name.ts';
import {
  resolveCreateFolderTemplateTokens,
  resolveReorderedFileTemplateTokens
} from './template-tokens.ts';

/**
 * Which kind of item a reorder is renumbering. Folders and files are never one sequence — the file explorer
 * always sorts folders above files, so a merged numbering could not be shown in the order it claims.
 */
export enum ReorderItemKind {
  File = 'File',
  Folder = 'Folder'
}

/**
 * Parameters for {@link buildRenameSteps}.
 */
export interface BuildRenameStepsParams {
  /**
   * The renumbered items, as {@link buildRenumberPlan} produced them.
   */
  readonly items: readonly RenumberedItem[];

  /**
   * Turns a wanted path into one nothing currently occupies. Injected rather than imported so this module
   * stays pure: the caller passes the vault-aware `getAvailablePath` / `getAvailableFolderPath`.
   *
   * @param desiredPath - The path a temporary rename would like to use.
   * @returns A free path.
   */
  readonly resolveTemporaryPath: (this: void, desiredPath: string) => string;
}

/**
 * Parameters for {@link buildRenumberPlan}.
 */
export interface BuildRenumberPlanParams {
  /**
   * The items **in the order the user chose** — position `0` becomes index `1`.
   */
  readonly items: readonly ReorderItemInput[];

  /**
   * Which kind of item is being renumbered, deciding both the template vocabulary and whether an extension
   * has to survive the rename.
   */
  readonly kind: ReorderItemKind;

  /**
   * The name template for this kind, as typed into its setting.
   */
  readonly nameTemplate: string;

  /**
   * The name of the folder holding the items.
   */
  readonly parentFolder: string;

  /**
   * The path of the folder holding the items.
   */
  readonly parentFolderPath: string;
}

/**
 * One rename to perform, in an order where the destination is always free.
 */
export interface RenameStep {
  readonly fromPath: string;

  /**
   * Whether this step only parks an item out of the way to break a cycle. A temporary step is always
   * followed, later in the list, by the step that gives the item its real name.
   */
  readonly isTemporary: boolean;
  readonly toPath: string;
}

/**
 * Parameters for {@link renderNumberedName}.
 */
export interface RenderNumberedNameParams {
  /**
   * The item's name with any index it already carried stripped off — what {@link parseNumberedName} read
   * back out of it.
   */
  readonly baseName: string;

  /**
   * The extension, leading dot included, or an empty string for a folder. Never templated.
   */
  readonly extension: string;

  /**
   * The number to write.
   */
  readonly index: number;

  /**
   * Which kind's token vocabulary the template speaks.
   */
  readonly kind: ReorderItemKind;

  /**
   * The name template for this kind, as typed into its setting.
   */
  readonly nameTemplate: string;

  /**
   * The name of the folder the item ends up in.
   */
  readonly parentFolder: string;

  /**
   * The path of the folder the item ends up in.
   */
  readonly parentFolderPath: string;
}

/**
 * One item with the name the reorder decided for it.
 */
export interface RenumberedItem {
  /**
   * The item's name with its old index removed, kept verbatim.
   */
  readonly baseName: string;

  /**
   * The position it was renumbered to, counting from `1`.
   */
  readonly index: number;

  /**
   * The new name, extension included for a file.
   */
  readonly newName: string;
  readonly newPath: string;
  readonly oldPath: string;
}

/**
 * One item as it stands before the reorder.
 */
export interface ReorderItemInput {
  /**
   * The extension, leading dot included, or an empty string for a folder. Never renumbered.
   */
  readonly extension: string;

  /**
   * The folder's name, or the file's basename — never the extension.
   */
  readonly name: string;
  readonly path: string;
}

/**
 * The token that carries the item's own name in each kind's name template. The settings validator requires
 * it, so a template can never renumber an item into a name that has lost the name.
 */
export const BASE_TOKEN_KEYS: Record<ReorderItemKind, string> = {
  [ReorderItemKind.File]: 'safeName',
  [ReorderItemKind.Folder]: 'safeFolderName'
};

/**
 * A cycle member parked under a temporary name until the rest of its cycle has unwound.
 */
interface ParkedItem {
  readonly item: RenumberedItem;
  readonly temporaryPath: string;
}

/**
 * Orders the renames of a {@link buildRenumberPlan} result so that every destination is free by the time it
 * is used, and reports the steps to perform.
 *
 * A reorder is a PERMUTATION, so a naive pass renames an item onto a name another item still holds
 * (`3. Gamma` → `2. Gamma` while `2. Beta` is still called that). Items are therefore emitted only once
 * nothing is standing on their destination. When nothing can be emitted, what is left is a true cycle — a
 * straight swap being the smallest one — and exactly ONE of its members is parked under a temporary name to
 * open it, then given its real name at the end. Only that one item is renamed twice, so link rewriting is
 * paid twice for one item per cycle rather than for every item.
 *
 * @param params - The renumbered items and the temporary-path resolver.
 * @returns The renames to perform, in order. Items whose name did not change produce no step at all.
 */
export function buildRenameSteps(params: BuildRenameStepsParams): readonly RenameStep[] {
  const { items, resolveTemporaryPath } = params;
  const steps: RenameStep[] = [];
  // Keyed by the path each pending item currently occupies, so a destination can be tested for an occupant.
  const pendingItemsByCurrentPath = new Map<string, RenumberedItem>();
  for (const item of items) {
    if (item.newPath !== item.oldPath) {
      pendingItemsByCurrentPath.set(item.oldPath, item);
    }
  }

  const parkedItems: ParkedItem[] = [];

  while (pendingItemsByCurrentPath.size > 0) {
    const freeItem = [...pendingItemsByCurrentPath.values()].find((item) => !pendingItemsByCurrentPath.has(item.newPath));
    if (freeItem) {
      steps.push({ fromPath: freeItem.oldPath, isTemporary: false, toPath: freeItem.newPath });
      pendingItemsByCurrentPath.delete(freeItem.oldPath);
      continue;
    }

    // Every remaining item is blocked by another remaining item: a cycle. Park one member so the rest of
    // the cycle can unwind, and give it its real name once the list has drained.
    // `ensureNonNullable` rather than an `if`: the loop condition guarantees a first entry, so a guard
    // here would be a branch nothing can reach — and the throw lives inside the helper (G10t).
    const cycledItem = ensureNonNullable(pendingItemsByCurrentPath.values().next().value);
    const temporaryPath = resolveTemporaryPath(cycledItem.newPath);
    steps.push({ fromPath: cycledItem.oldPath, isTemporary: true, toPath: temporaryPath });
    pendingItemsByCurrentPath.delete(cycledItem.oldPath);
    parkedItems.push({ item: cycledItem, temporaryPath });
  }

  for (const parkedItem of parkedItems) {
    steps.push({ fromPath: parkedItem.temporaryPath, isTemporary: false, toPath: parkedItem.item.newPath });
  }

  return steps;
}

/**
 * Renumbers a sequence: every item takes the number of its position, its old index is stripped, and
 * everything else about its name is left exactly as it was (issue #216).
 *
 * The whole sequence is rewritten rather than only the moved item — that is what the reporter's own plugin
 * does and the only thing that keeps the numbering contiguous — and an item that never carried an index
 * simply gains one.
 *
 * Nothing about the `N. ` shape is hard-coded: the name is rendered by this kind's template, so the
 * separator, the zero-padding (`{{index:000}}`) and even the index's POSITION are the template's to decide,
 * and {@link parseNumberedName} reads the old index back through that same template.
 *
 * @param params - The items in their new order, their kind, the template and the folder holding them.
 * @returns One entry per item, in the same order.
 */
export function buildRenumberPlan(params: BuildRenumberPlanParams): readonly RenumberedItem[] {
  const {
    items,
    kind,
    nameTemplate,
    parentFolder,
    parentFolderPath
  } = params;

  return items.map((item, position) => {
    const index = position + 1;
    const { baseName } = parseNumberedName({
      baseTokenKey: BASE_TOKEN_KEYS[kind],
      name: item.name,
      nameTemplate
    });
    const renderedName = renderNumberedName({
      baseName,
      extension: item.extension,
      index,
      kind,
      nameTemplate,
      parentFolder,
      parentFolderPath
    }).trim();
    const newName = `${renderedName || baseName}${item.extension}`;

    return {
      baseName,
      index,
      newName,
      // `normalizePath` is load-bearing for the vault ROOT, whose `path` is `/` — joining onto it would
      // otherwise yield a leading slash, which is not the path the item actually has.
      newPath: normalizePath(join(parentFolderPath, newName)),
      oldPath: item.path
    };
  });
}

/**
 * Renders one item's numbered name through its kind's own token vocabulary.
 *
 * The tokens naming the RESULT (`{{folderName}}` / `{{name}}` / the paths) resolve to nothing here, exactly
 * as they do while `Create folder with notes...` resolves its own name template — this template is what
 * produces them, and the settings validator rejects them rather than letting them render as emptiness.
 *
 * Exported for `numbered-moved-name.ts` (issue #273), which numbers an item a move or a flatten puts into a
 * new folder. That is the same two steps a reorder takes — strip the old index with
 * {@link parseNumberedName}, write the new one with this — differing only in where the index comes from, so
 * it is shared rather than written a second time. It lives HERE rather than beside `parseNumberedName` in
 * `numbered-name.ts` because it needs {@link ReorderItemKind} and {@link BASE_TOKEN_KEYS}, which this module
 * owns and that one is imported BY — putting it there would close an import cycle.
 *
 * @param params - The item's parsed name, the number to give it and the template.
 * @returns The rendered name, extension NOT included.
 */
export function renderNumberedName(params: RenderNumberedNameParams): string {
  const {
    baseName,
    extension,
    index,
    kind,
    nameTemplate,
    parentFolder,
    parentFolderPath
  } = params;

  if (kind === ReorderItemKind.File) {
    return resolveReorderedFileTemplateTokens({
      template: nameTemplate,
      tokens: {
        extension,
        index,
        name: '',
        parentFolder,
        parentFolderPath,
        path: '',
        safeName: baseName
      }
    });
  }

  return resolveCreateFolderTemplateTokens({
    template: nameTemplate,
    tokens: {
      folderName: '',
      folderPath: '',
      index,
      parentFolder,
      parentFolderPath,
      rawFolderName: '',
      safeFolderName: baseName
    }
  });
}
