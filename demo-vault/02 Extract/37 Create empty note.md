# Create empty note

An extract with nothing selected creates an **empty** note. That sounds like a trick, and it is the
fastest way there is to write a note you do not want to write yet: the note is created, a link to it is
left exactly where your cursor was, and you never leave the note you are typing in.

## From the cursor

1. Put the cursor anywhere below — mid-sentence is fine, nothing needs selecting.
2. Run `Create empty note at cursor...`.
3. Type a name and press `Enter`.

The new note is created **empty** — not with a blank line or two from
[31 Templates](<../09 Titles, links and frontmatter/31 Templates.md>), which have nothing to wrap around —
and a link to it appears at the cursor. Everything on either side of the cursor stays where it was.

---

Put the cursor in the middle of this sentence and make a note out of nothing.

## Why you would want that

Set [07 Text after extraction](<../02 Extract/07 Text after extraction.md>) to *link* (its default) and
leave `Should open target note after split` off (also its default), and this becomes a way to write
**links to notes that do not exist yet and then make them exist**, one keystroke at a time, without the
cursor ever moving. Tag or check them off later and you have a list of notes waiting to be filled in.

## The switch is fixed to `Create`

The picker's create/merge switch — [10 Create or merge when splitting](<../03 Split/10 Create or merge when splitting.md>) —
is shown but cannot be flipped here, and says why: there is no content to merge into an existing note, so
creating one is the only thing this command can do. It stays on `Create` even when
`Default split target mode` says otherwise.

## From the file explorer

Right-click a folder and choose `Create empty note in folder...` to create one empty note in it. It asks
for a name and opens the note when it is done — there is no cursor to preserve, so there is nothing to
leave behind either.

That is the single-note counterpart of
[22 Create folder with notes](<../06 Folder operations/22 Create folder with notes.md>), which creates a
whole folder from a template. Both apply the same naming rules: the name transform, the invalid-character
replacement, and the alias or `title` property that records the name you actually typed — see
[28 Invalid titles](<../09 Titles, links and frontmatter/28 Invalid titles.md>).

Run from the command palette instead of the folder menu, it creates the note in Obsidian's own
`Default location for new notes`.
