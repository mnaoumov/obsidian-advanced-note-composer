# Change target

**Every** confirmation dialog this plugin opens carries a **Change target** button (or press `Alt+C`),
so you can redirect an operation without cancelling it and triggering it again from the start.

Where the operation already asked you to pick a target, the button reopens that picker — preselected
with your previous choice for the split and merge-file pickers. Where the target was decided *for*
you, the button opens a folder picker and the dialog re-renders around your choice.

## Try it

1. Open any note and run `Merge current file with another file...`.
2. Pick [Merge target](<./Merge target.md>) and let the confirmation dialog appear.
3. Click **Change target** (or press `Alt+C`) — the picker comes back with your previous choice
   already selected.
4. Pick a different note and confirm. The merge lands in the note you chose second.

Dismissing the picker means "never mind": you go back to the same confirmation dialog with the target
unchanged, rather than losing the operation.

## What it picks, per operation

| Operation | What **Change target** picks |
| --- | --- |
| Split / extract, merge file, merge folder, swap file, swap folder, move folder | the original target picker, reopened |
| `Extract this heading...`, `Split note by headings` | the split target picker, which these normally skip — seeded with the heading |
| `Flatten folder` (all variants) | the folder the children are promoted into, instead of the folder's own parent |
| `Create folder with notes...` | the folder the new folder is created in; the name, numbering and note previews are all recomputed for it |
| `Merge folder into single file` | the folder the merged note lands in, overriding **Merge folder into file location** for this run only |
| `Split note by headings recursively`, `Split heading recursively` | the folder the produced tree is rooted in |

The notes for those operations are
[17 Flatten folder](<./17 Flatten folder.md>),
[23 Merge folder into single file](<./23 Merge folder into single file.md>),
[27 Split headings recursively](<./27 Split headings recursively.md>),
[29 Create folder with notes](<./29 Create folder with notes.md>) and
[32 Split heading recursively](<./32 Split heading recursively.md>).

A dialog you have parked can be brought back the same way — see
[15 Minimizing dialogs](<./15 Minimizing dialogs.md>).
