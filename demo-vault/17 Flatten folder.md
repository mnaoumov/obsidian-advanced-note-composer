# Flatten folder

Promote children of a folder up one level, so they become siblings of that folder. Subfolders are
moved whole (their internal structure is kept, not collapsed). Links are updated automatically, and
any name collision with an existing sibling is de-duplicated.

## Try it

1. Open [Note one](<./Flatten example/Note one.md>) inside the `Flatten example` folder.
2. Run `Flatten folder...`.
3. Read the confirmation dialog: it lists every item that is about to move, and shows the
   de-duplicated name (`a.md → a 1.md`) for anything that would collide with an existing sibling.
   Choose `Flatten`.
4. Watch [Note one](<./Flatten example/Note one.md>), [Note two](<./Flatten example/Note two.md>), and the `Nested` subfolder pop up one level (into the vault
   root), while `Flatten example` is left behind, now empty.

The link from [Note one](<./Flatten example/Note one.md>) to [Note two](<./Flatten example/Note two.md>) keeps resolving after the move, and `Nested` travels
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

- `Flatten folder...`
  - what the walkthrough above describes: everything moves, and `Flatten example` is left empty.
- `Flatten folder (child folders only)...`
  - only `Nested` moves. [Note one](<./Flatten example/Note one.md>) and [Note two](<./Flatten example/Note two.md>) stay
    put, so `Flatten example` survives intact. If those notes had an attachment folder inside `Flatten
    example`, it would stay too - it holds the attachments of notes that are not going anywhere.
- `Flatten folder recursively (all folders at any depth)...`
  - `Nested` **and** its own `Deeper` subfolder both land beside `Flatten example`, so a whole tree of
    folders collapses into one row of siblings. Each keeps the notes directly inside it:
    [Deep note](<./Flatten example/Nested/Deep note.md>) stays in `Nested`,
    [Deepest note](<./Flatten example/Nested/Deeper/Deepest note.md>) in `Deeper`.

`Flatten folder...` kept the command id it has always had, so a hotkey bound to it keeps working; the
two others start unbound.

## Why another folder shows fewer commands

All three appear on `Flatten example` because they all do something different there. Elsewhere you
will see fewer: a command hides itself when it would move exactly what a simpler one of the three
moves.

Try it on the `Nested` folder instead. It holds `Deeper` and nothing is nested below that, so
`Flatten folder recursively (all folders at any depth)...` would promote the same single folder
`Flatten folder (child folders only)...` promotes - and it is not offered. `Nested` also has a note of
its own ([Deep note](<./Flatten example/Nested/Deep note.md>)), which is what keeps the child-folders-only command there; on a folder holding
nothing but folders, that one steps aside too and only `Flatten folder...` is left.

What counts is what would really move, not how the folders look: a nested folder you excluded in the
settings, or one holding the attachments of a note that stays behind, is never promoted, so it does
not bring the recursive command back by itself.

If you run an attachment-location plugin such as Custom Attachment Location, where a note's attachment
folder is that plugin's answer rather than a setting, *that* half cannot be worked out while the menu
is being built - so `Flatten folder (child folders only)...` stays listed and tells you afterwards if
nothing would move. Whether anything nests is not an attachment question, so it is answered as usual
and `Flatten folder recursively (all folders at any depth)...` still steps aside on a folder like
`Nested`. Your vault's `Default location for new attachments` is ignored in that case on purpose: the
plugin keeps it pointed at whatever folder it last resolved for the note you have open, which used to
make an ordinary folder look like an attachment folder and take two of the commands away.
