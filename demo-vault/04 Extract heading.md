[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Extract heading

Extract a heading **and everything under it** into its own note, named after the heading.

## Try it

1. Put the cursor inside the `## Ideas worth their own note` section below.
2. Run `Extract this heading...`.
3. Confirm - a new note named `Ideas worth their own note` is created with that section's
   content, and a link is left here.

## Ideas worth their own note

This whole section - heading and body - becomes a separate note. The heading text becomes
the new note's title, so invalid characters and slashes matter here (see [[11 Invalid titles]]
and [[12 Treat title as path]]).

## Another section

This section stays behind, because only the heading the cursor is in gets extracted.
