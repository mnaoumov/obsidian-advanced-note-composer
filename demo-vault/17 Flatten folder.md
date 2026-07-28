[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Flatten folder

Promote every **direct child** of a folder up one level, so its notes and subfolders become siblings
of that folder. Subfolders are moved whole (their internal structure is kept, not collapsed). Links
are updated automatically, and any name collision with an existing sibling is de-duplicated.

## Try it

1. Open [[Note one]] inside the `Flatten example` folder.
2. Run `Flatten folder...`.
3. Read the confirmation dialog: it lists every item that is about to move, and shows the
   de-duplicated name (`a.md → a 1.md`) for anything that would collide with an existing sibling.
   Choose `Flatten`.
4. Watch [[Note one]], [[Note two]], and the `Nested` subfolder pop up one level (into the vault
   root), while `Flatten example` is left behind, now empty.

The link from [[Note one]] to [[Note two]] keeps resolving after the move, and `Nested` travels
with its own note inside it.

The dialog is there because this command has no picker to review before it acts. Tick
`Don't ask again` in it, or turn off **Should ask before flattening a folder** under
`Move/flatten folders` in the settings, to flatten straight away.
