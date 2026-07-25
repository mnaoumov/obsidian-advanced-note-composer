[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Flatten folder

Promote every **direct child** of a folder up one level, so its notes and subfolders become siblings
of that folder. Subfolders are moved whole (their internal structure is kept, not collapsed). Links
are updated automatically, and any name collision with an existing sibling is de-duplicated.

## Try it

1. Open [[Note one]] inside the `Flatten example` folder.
2. Run `Flatten folder...`.
3. Watch [[Note one]], [[Note two]], and the `Nested` subfolder pop up one level (into the vault
   root), while `Flatten example` is left behind, now empty.

The link from [[Note one]] to [[Note two]] keeps resolving after the move, and `Nested` travels
with its own note inside it.
