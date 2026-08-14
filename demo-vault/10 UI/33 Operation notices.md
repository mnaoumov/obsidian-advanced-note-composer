# Operation notices

Every operation this plugin runs tells you about itself: a notice **while it is running**, so you know
when not to touch Obsidian, and a notice **naming what it did** once it finished. Merging, splitting and
extracting, swapping, moving and flattening folders, renaming a heading and reordering headings all report
the same way.

The running notice only appears once an operation has been going for about half a second, so quick ones
never flash one up - and it is the notice that carries the operation's **Cancel** button.

## Try it

1. Run any operation from another note in this vault -
   [20 Flatten folder](<../06 Folder operations/20 Flatten folder.md>) and [17 Swap file](<../05 Swap/17 Swap file.md>) are
   quick ones.
2. Watch the bottom-right corner. When it finishes you get a notice like
   `Flattened folder Demo into /, promoting 3 item(s).` - the note and folder names in it are clickable.
3. Click one. The note opens **and** is highlighted in the file explorer, so you can see where it lives.
   Click a folder name instead and that folder's folder note opens - and is the highlighted one.
4. Open `Settings -> Advanced Note Composer -> UI` and turn **Should show operation notices** off.
5. Run the same operation again. It does exactly the same thing, silently.
6. Turn the setting back on.

## Clicking a notice

The names in a notice are links, and clicking one does two things: it opens the note and it **highlights it
in the file explorer**.

A **folder** name does the same thing one step removed: a folder cannot be opened, so the click opens that
folder's **folder note** and highlights *the note*, leaving you in a document rather than in the explorer.
The folder is still on screen - highlighting a note expands the folder holding it. Which note that is comes
from **Folder note location** and **Folder note name template**, the same settings a rename and a reorder
keep in step - see [24 Rename folder](<../06 Folder operations/24 Rename folder.md>). A folder whose note is
hidden in the explorer, or that has no folder note at all, highlights the folder instead; nothing is ever
created by clicking.

An operation that creates SEVERAL notes - splitting a note by its headings, or splitting a heading
recursively - also **names what it created**, after the count: `Split heading in Source into 7 note(s):
Chapter 1.` Only the notes at the top of what it produced are named, at most three of them and then
`and 4 more`, because a recursive split can turn one heading into a whole folder tree and no corner notice
could list it. The rest are never lost: a split leaves a link to every note it produced in the note it
split, so the **source** name - still the first link in the notice - is the index of the whole run.

An **extract** goes one step further. Clicking the destination of `Split note A into B` puts you *on the
content you just extracted*, selected and scrolled into view, instead of at the top of `B` - which is the
point when you extracted three lines into the bottom of a long note. Nothing to configure; it is what the
link does.

## Good to know

- Refusals and errors - "this path is ignored in the plugin settings" and the like - are **always** shown,
  whatever this setting says.
- With the setting off you also lose the `Cancel` button that lives on the running notice. A long operation
  can still be cancelled by right-clicking the note's lock indicator and unlocking it.
- Two related settings are separate on purpose: **Should show smart cut & paste notice** controls the
  *interactive* marked-selection notice (turning it off removes its buttons, not just information), and
  **Smart cut & paste completion feedback** already decides how a finished move announces itself - see
  [25 Smart cut and paste](<../07 Smart cut and paste/25 Smart cut and paste.md>).
