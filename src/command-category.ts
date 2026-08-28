/**
 * @file
 *
 * The command grouping every per-category setting is keyed by.
 *
 * Its own module, and deliberately free of any `obsidian` / `obsidian-dev-utils` runtime import, so
 * `menu-placeable-commands.ts` can name a category without dragging the Obsidian runtime in — an
 * integration test imports that table from plain Node, where `obsidian` does not resolve.
 * `plugin-settings.ts` re-exports both members, so every existing import keeps working.
 */

/**
 * The group of commands that one pair of per-category `Command include/exclude paths` settings narrows
 * (issue #249).
 *
 * Command blocking used to be all-or-nothing: a path listed in {@link PluginSettings.commandExcludePaths}
 * lost EVERY Advanced Note Composer command. The request was to block merges on a path while keeping the
 * rest of the commands there, so each command now names the category it belongs to and each category
 * carries a path filter of its own, layered on top of that un-prefixed baseline pair.
 *
 * Categories rather than the ~40 individual command ids, because that is the granularity the request was
 * written in — "merges", "reordering", "renaming folder" — and because per-id lists would mean eighty
 * settings rows. The values are the settings-tab group headings verbatim, so `data.json`, the settings UI
 * and the demo vault all name a category the same way.
 *
 * `cancel-move` and `open-split-modal` are deliberately outside every category: neither consults the
 * command filter at all today. The first has no path to check, and letting the second be blocked would be
 * a behavior change beyond what the issue asks for.
 */
export enum CommandCategory {
  Create = 'Create',
  Merge = 'Merge',
  MoveAndFlatten = 'Move/flatten',
  Rename = 'Rename',
  Reorder = 'Reorder',
  Select = 'Select',
  SmartCutAndPaste = 'Smart cut & paste',
  SplitAndExtract = 'Split/extract',
  Swap = 'Swap'
}

/**
 * Every {@link CommandCategory}, in the order the settings tab lists them.
 *
 * Spelled out rather than derived from `Object.values`, which `@total-typescript/ts-reset` types as
 * `unknown[]`, and which would hide a category added without the two settings that go with it — the unit
 * test comparing this list against the enum's own keys is what turns that omission into a failure.
 */
export const COMMAND_CATEGORIES: readonly CommandCategory[] = [
  CommandCategory.Merge,
  CommandCategory.SplitAndExtract,
  CommandCategory.Select,
  CommandCategory.Create,
  CommandCategory.SmartCutAndPaste,
  CommandCategory.Swap,
  CommandCategory.MoveAndFlatten,
  CommandCategory.Rename,
  CommandCategory.Reorder
];
