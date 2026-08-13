# Merge multiple selected files

Select **several notes at once** in the file explorer and merge them all into a single target note in
one go - no need to merge them one pair at a time.

## Try it

1. In the file explorer, open the `Merge multiple files` folder.
2. Select more than one note - for example [Note A](<./Merge multiple files/Note A.md>) and [Note B](<./Merge multiple files/Note B.md>) (Ctrl/Cmd-click, or Shift-click a
   range).
3. Right-click the selection and choose `Merge these files into one file...`.
4. Pick the target note - for example [Combined](<./Merge multiple files/Combined.md>) - and confirm.

[Note A](<./Merge multiple files/Note A.md>) and [Note B](<./Merge multiple files/Note B.md>) are merged, in order, into [Combined](<./Merge multiple files/Combined.md>) and then deleted. Each note runs
through the same merge pipeline as a single-file merge, so your **Merge template**, **frontmatter merge
strategy**, footnote fixing, and link/backlink updates all apply, and the whole batch runs in one
reversible transaction.

## Notes

- The command appears on the multiple-selection context menu only when **two or more** markdown notes are
  selected.
- The target picker lists your existing notes (the selected notes themselves are excluded). To combine
  into a fresh note, create an empty note first and pick it as the target.
- Notes whose path is excluded/ignored in the plugin settings are skipped and reported - unless
  **Should always merge excluded items** is on.
