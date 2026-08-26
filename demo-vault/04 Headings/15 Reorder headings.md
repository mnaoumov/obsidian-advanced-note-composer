# Reorder headings

Reorder a note's **headings at any level** without cutting and pasting. The dialog shows the whole heading tree as an indented list; the up/down arrows move a heading (and everything nested under it) among its **same-parent siblings only**, so nesting is always preserved.

## Try it

1. Put the cursor anywhere in this note.
2. Run `Reorder headings...`.
3. In the dialog, use the up/down arrows:
   - Move a top-level section - for example, `Beta` above `Alpha`.
   - Or reorder the nested siblings `Alpha detail` and `More Alpha detail` under `Alpha` - they only swap with each other, never leaving `Alpha`.
4. Click **Reorder**. The sections are rewritten in the new order; any content before the first heading (the preamble) stays put.

## Alpha

The Alpha section. Its body travels with the heading when you reorder.

### Alpha detail

A nested subheading. It can be reordered against its sibling below, but it stays under `Alpha`.

### More Alpha detail

A second nested sibling, so you can reorder the two `###` headings under `Alpha`.

## Beta

The Beta section.

## Gamma

The Gamma section.
