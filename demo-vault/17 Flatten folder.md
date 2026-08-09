[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Flatten folder

Promote children of a folder up one level, so they become siblings of that folder. Subfolders are
moved whole (their internal structure is kept, not collapsed). Links are updated automatically, and
any name collision with an existing sibling is de-duplicated.

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

## Send the children somewhere else

The children go to the folder's own parent by default, but that is only the default. Run
`Flatten folder...` again and press `Change target` (or `Alt+C`) in the dialog: pick any other folder
and the preview redraws for it - including the de-duplicated names, which depend on what is already
sitting in the destination you chose. The folder's own subtree is not offered, since the children are
already inside it. Dismissing the picker leaves the destination as it was and returns you to the
dialog, so a change of mind costs nothing.

## Try the other flatten commands

*What* gets promoted is decided by **which command you run** - there is no setting to flip. Undo the
flatten above, then right-click `Flatten example` in the file explorer and pick one of the other two
(they are in the command palette as well, acting on the folder of the note you have open).

- `Flatten folder...` - what the walkthrough above describes: everything moves, and `Flatten example`
  is left empty.
- `Flatten folder (child folders only)...` - only `Nested` moves. [[Note one]] and [[Note two]] stay
  put, so `Flatten example` survives intact. If those notes had an attachment folder inside `Flatten
  example`, it would stay too - it holds the attachments of notes that are not going anywhere.
- `Flatten folder recursively (all folders at any depth)...` - `Nested` **and** its own `Deeper`
  subfolder both land beside `Flatten example`, so a whole tree of folders collapses into one row of
  siblings. Each keeps the notes directly inside it: [[Deep note]] stays in `Nested`,
  [[Deepest note]] in `Deeper`.

`Flatten folder...` kept the command id it has always had, so a hotkey bound to it keeps working; the
two others start unbound.
