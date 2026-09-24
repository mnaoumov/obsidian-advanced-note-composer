# Heading links

A note whose headings link to one another - `[[#Second]]`, `[[#^quote]]` - keeps those links working when this plugin takes the note apart. Each link ends up pointing at the note that now holds its heading or block, wherever the link itself ended up:

- a link that moves **together with** its heading is left exactly as you wrote it;
- a link that moves **away from** its heading, or stays behind while the heading leaves, is pointed at the heading's new note, keeping any alias.

It works for every split, extract and merge, and for a link however it was written: typed, picked from the `[[#` suggester, or copied with `Copy link to this heading`.

## Copy a link to a heading

Put the cursor anywhere in a heading's section - on the heading line or in its body - and run `Copy link to this heading`. It copies the same link Obsidian writes when you pick that heading from the `[[#` suggester, so your `New link format` and `Use [[Wikilinks]]` settings decide its shape. Paste it into another heading of the same note.

## Try it

1. Open [Linked headings](<../Materials/42 Heading links/Linked headings.md>).
2. Put the cursor in the body of `### Second` and run `Copy link to this heading`: `[[#Second]]` is on the clipboard.
3. Put the cursor in the body of `## First` and run `Split heading recursively...`.
4. Open the notes it creates. `First` points at `[[Second#Second]]` and `[[Third#^quote]]`, `Second` at `[[First#First]]` and `[[Third#Third]]`, and the introduction left in `Linked headings` points at `[[Second#Second]]` and `[[Third#Third]]`.
