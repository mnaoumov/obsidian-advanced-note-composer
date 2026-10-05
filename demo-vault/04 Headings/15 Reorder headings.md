# Reorder headings

Reorder a note's **headings at any level** without cutting and pasting. The dialog shows the whole heading tree as an indented list, and a heading always moves together with everything nested under it:

- The **up/down arrows** move a heading among its siblings.
- **Dragging** a heading onto another one moves it anywhere in the tree: drop on the top of a row to put it before that heading, on the bottom to put it after, or on the middle to put it **inside** it.
- The **left/right arrows** move a heading out of its parent, or under the heading above it.

A heading that lands under a different parent is **re-leveled** to fit - `### Alpha detail` dragged beside `## Beta` becomes `## Alpha detail` - and everything under it shifts by the same amount. Links that spelled out the old nesting, such as `[[note#Alpha#Alpha detail]]`, are rewritten to the new one.

## Try it

1. Put the cursor anywhere in this note.
2. Run `Reorder headings...`.
3. In the dialog, try any of:
   - Move a top-level section with the up/down arrows - for example, `Beta` above `Alpha`.
   - Drag `More Alpha detail` onto the middle of `Beta`, so it becomes `### More Alpha detail` under `Beta`.
   - Press the right arrow on `Gamma` to put it under `Beta` as `### Gamma`.
4. Click **Reorder**. The sections are rewritten in the new order and levels; any content before the first heading (the preamble) stays put.

## Numbering headings

Tick **Number headings** in the dialog to number every heading the way folders and notes are numbered: `1. Alpha`, then `1. Alpha detail` and `2. More Alpha detail` under it, then `2. Beta`. Each row shows the heading as it will be written, and the numbers follow every move you make.

- A note whose headings are **all numbered** already opens with the box ticked, so its numbers stay correct after every reorder without anything to remember.
- Clear the box on such a note to **remove** its numbers.
- The format is the `Heading number template` setting. `{{index}}` is the position among siblings, and `{{outlineIndex}}` is the whole chain, such as `1.2.3`.
- Links to a renumbered heading, such as `[[note#1. Alpha]]`, are rewritten to its new number.

## Sorting headings

The **Sort** row at the top of the dialog sorts every heading of one level at once. Each heading takes its content and subheadings with it.

1. Choose what to sort by in the first dropdown: **Name**, **Created time**, **Modified time** or **Recently seen**.
2. Choose a level in the second dropdown. It starts on the shallowest level that has more than one heading, so a lone title heading is skipped. Choose **All levels** to sort every level.
3. Click one of the two buttons. Their labels follow the first dropdown: **A to Z** / **Z to A** for a name, **Oldest first** / **Newest first** for a time, **Recent on bottom** / **Recent on top** for recently seen. The list shows the new order, and you can still adjust it by hand before clicking **Reorder**.

### Sorting by time

Obsidian does not record when a heading was created, changed or looked at. The three time sorts read those times from the [Advanced Metadata Cache](https://github.com/mnaoumov/obsidian-advanced-metadata-cache) plugin, version 1.2.0 or later, with its `Headings` module turned on. Without it they are shown in the dropdown but disabled.

- **Created time** is when the heading first appeared.
- **Modified time** is when anything in its section last changed, subheadings included. Moving the section does not count.
- **Recently seen** is when its section was last on screen in the editor.

A heading that was already there before Advanced Metadata Cache started tracking the note has no time, and counts as the oldest.

### Sorting by name

Numbers sort as numbers, so the order is chronological for:

- Versions: `1.10.0` comes after `1.9.0`.
- Dates such as `2026-10-04`.
- Timestamps from the `Unique note creator` core plugin, such as `202610041438`.

**Z to A** puts the newest changelog entry on top. After you move headings around for a while, sorting again restores their order. The numbers that `Number headings` writes are ignored when sorting.

## Alpha

The Alpha section. Its body travels with the heading when you reorder.

### Alpha detail

A nested subheading. Reorder it against its sibling below, or drag it under `Beta`.

### More Alpha detail

A second nested sibling, so you can reorder the two `###` headings under `Alpha`.

## Beta

The Beta section.

## Gamma

The Gamma section.
