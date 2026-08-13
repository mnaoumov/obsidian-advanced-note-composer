# Move folder

Move a whole folder into another folder chosen from a picker. Links are updated automatically, and a
name collision in the destination is de-duplicated. The picker never offers the folder's own subtree
or its current parent, and it respects the plugin's ignored paths.

Just like the merge-folder picker, when you open it with an empty query the **most recently opened
folders** are listed first (the folders of the notes you have visited most recently, minus any the
constraints above exclude), so a common destination is one keystroke away.

## Try it

1. Open [Movable note](<./Move example/Movable note.md>) inside the `Move example` folder.
2. Run `Move folder to...`.
3. In the picker, choose the `Move destination` folder.
4. The confirmation dialog shows the folder and where it is going. Pick `Change target` to go back to
   the picker, or `Move` to go ahead.
5. Watch `Move example` land inside `Move destination` (as `Move destination/Move example`), with
   [Movable note](<./Move example/Movable note.md>) carried along.

The link from [Points here](<./Points here.md>) to [Movable note](<./Move example/Movable note.md>) keeps resolving after the folder moves.

Tick `Don't ask again` in the dialog, or turn off **Should ask before moving a folder** under
`Move/flatten folders` in the settings, to move as soon as you pick a destination.
