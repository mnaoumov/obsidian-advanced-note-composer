[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Extract heading

Extract a heading **and everything under it** into its own note, named after the heading.

## Try it

1. Click **anywhere inside the body** of the `## Ideas worth their own note` section below - for
   example, in the middle of the paragraph. You do **not** have to put the cursor on the `##` heading
   line itself (issue #143): anywhere within the section works.
2. Run `Extract this heading...`.
3. Confirm - a new note named `Ideas worth their own note` is created with that section's
   content, and a link is left here.

## Right-click with a selection

Select some text first and right-click it: `Extract this heading...` is **not** in the menu
(issue #188). A selection is a question about the selection, so `Extract current selection...` is what
you get. Click once to drop the selection and the heading command is back — still from anywhere inside
the section.

## Ideas worth their own note

This whole section - heading and body - becomes a separate note. Put your cursor right here, on this
body line, and the extraction still grabs the entire section. The heading text becomes the new note's
title, so invalid characters and slashes matter here (see [[11 Invalid titles]] and
[[12 Treat title as path]]).

## Another section

This section stays behind, because only the heading the cursor is in gets extracted.
