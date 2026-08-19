# Folder operations

Obsidian gives a folder a rename and a delete. These five commands give it the rest: promoting its
children, moving it somewhere else, creating one already filled with notes, and keeping a numbered
sequence of folders in order. Each runs as one reversible, resource-locked transaction, and each keeps
the folder's own folder note in step.

Each also reports what it did in a notice whose folder name is clickable: clicking it highlights the folder
and opens that folder note — see [33 Operation notices](<../10 UI/33 Operation notices.md>).

| Note | What it covers |
| --- | --- |
| [20 Flatten folder](<./20 Flatten folder.md>) | Promoting a folder's children up one level — three variants, and why you sometimes see fewer |
| [21 Move folder to](<./21 Move folder to.md>) | Moving a whole folder into another one you pick |
| [22 Create folder with notes](<./22 Create folder with notes.md>) | A folder and the notes inside it in one step, from a template |
| [23 Reorder folders](<./23 Reorder folders.md>) | Putting sibling or child folders in your order and renumbering them |
| [24 Rename folder](<./24 Rename folder.md>) | Renaming a folder, keeping its number, its folder note and its aliases in step |

One more command lives on the same folder menu without being a folder operation: `Create empty note in
folder...` puts a single empty note in the folder you right-clicked — the one-note counterpart of
[22 Create folder with notes](<./22 Create folder with notes.md>), documented in
[37 Create empty note](<../02 Extract/37 Create empty note.md>).
