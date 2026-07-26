[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Move folder

Move a whole folder into another folder chosen from a picker. Links are updated automatically, and a
name collision in the destination is de-duplicated. The picker never offers the folder's own subtree
or its current parent, and it respects the plugin's ignored paths.

Just like the merge-folder picker, when you open it with an empty query the **most recently opened
folders** are listed first (the folders of the notes you have visited most recently, minus any the
constraints above exclude), so a common destination is one keystroke away.

## Try it

1. Open [[Movable note]] inside the `Move example` folder.
2. Run `Move folder to...`.
3. In the picker, choose the `Move destination` folder and confirm.
4. Watch `Move example` land inside `Move destination` (as `Move destination/Move example`), with
   [[Movable note]] carried along.

The link from [[Points here]] to [[Movable note]] keeps resolving after the folder moves.
