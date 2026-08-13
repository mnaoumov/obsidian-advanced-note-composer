# Start here

This is an [Obsidian](https://obsidian.md/) vault that documents the
[Advanced Note Composer](https://github.com/mnaoumov/obsidian-advanced-note-composer/) plugin by
demonstrating it. Every feature has a note that explains what it is for, and most give you a button
that runs it for real. Read it here on GitHub, or open it in Obsidian and click things.

Obsidian's core `Note composer` moves text between notes, but it moves it bluntly: relative links come
out pointing at nothing, a heading whose title contains a character a file name cannot hold is refused
outright, and extracted text is always appended to the target. This plugin fixes those, and then goes
much further — whole folders can be merged, split, flattened, reordered and renamed, a note's heading
hierarchy can become a folder tree, and a selection can be marked in one note and dropped at an exact
cursor position in another.

## Your first two minutes

1. Open [01 Merge file](<./01 Merge/01 Merge file.md>).
2. Follow its four steps: run `Merge current file with another file...`, pick `Merge target`, confirm.
   The note's body — footnote and all — lands in the target, renumbered so it does not collide.
3. Now open [30 Frontmatter merge strategy](<./09 Titles, links and frontmatter/30 Frontmatter merge strategy.md>)
   and look at the first captioned rectangle. **That is a button: click it** and it runs the code it
   contains, here setting a merge strategy for you. The result appears below it, and the `</>` toggle
   beside it reveals the source.
4. Merge the two example notes again and watch the frontmatter resolve differently.

That is the whole model: read what a feature does, click a button to put the plugin into the state that
shows it off, then run the command yourself. Every note also spells out the manual equivalent, so you
never strictly need the buttons. They are powered by
[`CodeScript Toolkit`](https://github.com/mnaoumov/obsidian-codescript-toolkit/), which this vault
installs for you automatically on first open.

## Work through the folders

Each folder opens with a note of its own listing what is inside, so the File Explorer tells you what
every note is for without sending you back here.

| Folder | What it covers |
| --- | --- |
| [01 Merge](<./01 Merge/README.md>) | Combining notes: one into another, a folder into a folder, several at once, or a whole tree into one file |
| [02 Extract](<./02 Extract/README.md>) | Taking part of a note out: a selection, a heading, the block between two rules — and what is left behind |
| [03 Split](<./03 Split/README.md>) | Breaking a note apart by its headings, into notes or into a folder tree |
| [04 Headings](<./04 Headings/README.md>) | Reordering a note's sections, and renaming a heading so its backlinks follow |
| [05 Swap](<./05 Swap/README.md>) | Two files, two folders or two selections trading places |
| [06 Folder operations](<./06 Folder operations/README.md>) | Flattening, moving, creating, reordering and renaming folders — and their folder notes |
| [07 Smart cut and paste](<./07 Smart cut and paste/README.md>) | Mark text in one note, drop it exactly where you want in another |
| [08 Include and exclude](<./08 Include and exclude/README.md>) | The two path filters: what the plugin may touch, and where its commands appear |
| [09 Titles, links and frontmatter](<./09 Titles, links and frontmatter/README.md>) | The parts every operation shares: link fixing, titles, properties and templates |
| [10 UI](<./10 UI/README.md>) | Dialogs you can park or point elsewhere, the notices operations show, and finding a setting |

## Materials

`Materials/` holds the notes and folders the walkthroughs operate on, one folder per note that needs
them — `Materials/20 Flatten folder/` belongs to
[20 Flatten folder](<./06 Folder operations/20 Flatten folder.md>). You never have to open it directly;
each note links to what it needs. It exists so that what you see at the top level is the documentation,
rather than a pile of example data mixed in with it.
