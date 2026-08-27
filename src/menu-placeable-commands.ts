/**
 * @file
 *
 * Every command that can appear in a markdown editor's context menus, and the category it belongs to.
 *
 * The list the settings UI renders a placement row from (issue #254). Placement used to be decided one
 * CATEGORY at a time, which the reporter of #254 could not live with: `Split/extract` alone puts fifteen
 * commands in the menu, and demoting the recursive splits to the margin meant demoting every extract with
 * them. The category survives only as the heading a row is grouped under.
 *
 * Ids and names are spelled out rather than read off the live handlers, because the settings tab is built
 * when the tab is REGISTERED — `getSettingDefinitionItems` runs at `addSettingTab` time so Obsidian can
 * index the rows for search, which is before a handler instance is anything the tab could ask. The cost is
 * that this table can drift from what `plugin.ts` registers, so
 * `command-menu-placement.desktop.integration.test.ts` asserts every id here resolves to a REAL registered
 * command in Obsidian — drift fails there rather than showing the user a row that governs nothing.
 */

import type { Level } from './markdown-heading-document.ts';

import { CommandCategory } from './command-category.ts';

/**
 * A command whose context-menu placement the user can choose.
 */
export interface MenuPlaceableCommand {
  /**
   * The category the command belongs to — the settings group its row is listed under, and nothing else
   * since issue #254.
   */
  readonly commandCategory: CommandCategory;

  /**
   * The command's id, WITHOUT the plugin-id prefix Obsidian adds — the same string the handler passes to
   * its base constructor, and the key its placement is stored under.
   */
  readonly id: string;

  /**
   * The command's display name, exactly as the command palette shows it, so a settings row can be matched
   * against the palette character-for-character.
   */
  readonly name: string;
}

/**
 * The heading levels the two by-heading split commands are registered for, mirroring `plugin.ts`.
 */
// eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
const HEADING_LEVELS: readonly Level[] = [1, 2, 3, 4, 5, 6];

/**
 * Every command that reaches an editor or viewport context menu, in the order the settings tab lists them.
 *
 * The two categories missing entirely — {@link CommandCategory.Merge} and
 * {@link CommandCategory.MoveAndFlatten} — are made up of file- and folder-menu commands, which no editor
 * menu ever offers, so neither has a placement to choose.
 */
export const MENU_PLACEABLE_COMMANDS: readonly MenuPlaceableCommand[] = [
  {
    commandCategory: CommandCategory.SplitAndExtract,
    id: 'extract-current-selection',
    name: 'Extract current selection...'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    id: 'extract-this-heading',
    name: 'Extract this heading...'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    id: 'extract-before-cursor',
    name: 'Extract before cursor...'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    id: 'extract-after-cursor',
    name: 'Extract after cursor...'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    id: 'extract-between-horizontal-rules',
    name: 'Extract between horizontal rules...'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    id: 'split-heading-recursively',
    name: 'Split heading recursively...'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    id: 'split-note-by-headings-recursively',
    name: 'Split note by headings recursively...'
  },
  ...HEADING_LEVELS.map((headingLevel) => ({
    commandCategory: CommandCategory.SplitAndExtract,
    id: `split-note-by-headings-h${String(headingLevel)}`,
    name: `Split note by headings - H${String(headingLevel)}`
  })),
  ...HEADING_LEVELS.map((headingLevel) => ({
    commandCategory: CommandCategory.SplitAndExtract,
    id: `split-note-by-headings-content-h${String(headingLevel)}`,
    name: `Split note by headings content - H${String(headingLevel)}`
  })),
  {
    commandCategory: CommandCategory.Create,
    id: 'create-empty-note-at-cursor',
    name: 'Create empty note at cursor...'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    id: 'mark-selection-to-move',
    name: 'Smart cut & paste: Mark selection to move'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    id: 'mark-heading-to-move',
    name: 'Smart cut & paste: Mark heading to move'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    id: 'move-marked-selection-here',
    name: 'Smart cut & paste: Move marked selection here'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    id: 'move-marked-selection-here-advanced',
    name: 'Smart cut & paste: Move marked selection here (advanced)...'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    id: 'move-marked-selection-to-top-of-file',
    name: 'Smart cut & paste: Move marked selection to top of file'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    id: 'move-marked-selection-to-bottom-of-file',
    name: 'Smart cut & paste: Move marked selection to bottom of file'
  },
  {
    commandCategory: CommandCategory.Swap,
    id: 'mark-selection-to-swap',
    name: 'Swap selections: Mark selection to swap'
  },
  {
    commandCategory: CommandCategory.Swap,
    id: 'swap-with-marked-selection',
    name: 'Swap selections: Swap with marked selection'
  },
  {
    commandCategory: CommandCategory.Rename,
    id: 'rename-heading',
    name: 'Rename heading...'
  },
  {
    commandCategory: CommandCategory.Reorder,
    id: 'reorder-headings',
    name: 'Reorder headings...'
  }
];

/**
 * The categories {@link MENU_PLACEABLE_COMMANDS} covers, in list order — the settings groups to render.
 *
 * Derived from the table rather than spelled out beside it, so a category cannot be listed with no
 * commands under it, nor a command land in a group that is never rendered.
 *
 * @returns The categories, each appearing once.
 */
export function menuPlaceableCommandCategories(): CommandCategory[] {
  const categories: CommandCategory[] = [];
  for (const command of MENU_PLACEABLE_COMMANDS) {
    if (!categories.includes(command.commandCategory)) {
      categories.push(command.commandCategory);
    }
  }
  return categories;
}

/**
 * The commands of one category, in list order.
 *
 * @param commandCategory - The category.
 * @returns Its menu-placeable commands.
 */
export function menuPlaceableCommandsOfCategory(commandCategory: CommandCategory): MenuPlaceableCommand[] {
  return MENU_PLACEABLE_COMMANDS.filter((command) => command.commandCategory === commandCategory);
}
