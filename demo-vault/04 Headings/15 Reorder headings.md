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
