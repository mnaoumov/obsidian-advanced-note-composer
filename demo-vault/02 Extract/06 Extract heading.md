# Extract heading

Extract a heading **and everything under it** into its own note, named after the heading.

## Try it

1. Click **anywhere inside the body** of the `## Ideas worth their own note` section below - for example, in the middle of the paragraph. You do **not** have to put the cursor on the `##` heading line itself (issue #143): anywhere within the section works.
2. Run `Extract this heading...`.
3. Confirm - a new note named `Ideas worth their own note` is created with that section's content, and a link is left here.

## Right-click with a selection

Select some text first and right-click it: `Extract this heading...` is **not** in the menu (issue #188). A selection is a question about the selection, so `Extract current selection...` is what you get. Click once to drop the selection and the heading command is back — still from anywhere inside the section.

The same rule governs the other two whole-note commands, so with a selection active the editor menu offers only what acts on a selection. Three commands step aside:

- `Extract this heading...`
- [`Split heading recursively...`](<../03 Split/14 Split heading recursively.md>)
- [`Split note by headings recursively...`](<../03 Split/13 Split headings recursively.md>)

This affects the **editor's right-click menu only**. All three stay in the command palette and on any hotkey you assigned, selection or not — nothing you can do today stops working.

Two related rules are unchanged: `Split note by headings - H<n>` (and its `content` variant) is offered whenever the cursor or selection sits anywhere inside a heading of that level, and `Extract this heading...` — with nothing selected — works from anywhere inside a heading's section rather than only from the heading line. `Split heading recursively...` resolves its heading the same way.

## Ideas worth their own note

This whole section - heading and body - becomes a separate note. Put your cursor right here, on this body line, and the extraction still grabs the entire section. The heading text becomes the new note's title, so invalid characters and slashes matter here (see [28 Invalid titles](<../09 Titles, links and frontmatter/28 Invalid titles.md>) and [29 Treat title as path](<../09 Titles, links and frontmatter/29 Treat title as path.md>)).

## Another section

This section stays behind, because only the heading the cursor is in gets extracted.
