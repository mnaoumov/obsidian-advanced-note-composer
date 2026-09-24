# Finding a setting

This plugin has a lot of settings, and a single long scroll through all of them is no way to find one. The settings tab opens instead as a short list of **pages** you navigate into.

## Try it

1. Open `Settings -> Advanced Note Composer`.
2. You get a list of pages rather than a wall of settings: `Merge`, `Split/extract`, `Select`, `Swap`, `Smart cut & paste`, `Frontmatter`, the folder pages, `Rename`, `Reorder` and `UI`.
3. Click `Merge`. It does not open onto a long list of settings. It opens onto a short list of **sections**, each one a page of its own that you click into, divided by **which command they apply to**: `All merges` for the settings every merge honors, then `Merge file`, `Merge folder contents into a single file` and `Merge current folder with another folder`, and finally `Merge include/exclude paths` for the four path boxes that decide where the merge commands work and where they are offered.
4. Click `All merges`, then use the back arrow at the top of the page. You land on `Merge` again, not at the top of the tab, so moving between the sections of one page is a click each way.
5. Go back and try `Smart cut & paste`, which splits the same way: one setting that governs the mark itself sits directly on the page, followed by `Notice`, then one section per destination (`At cursor`, `To top of file`, `To bottom of file`), then its own `Smart cut & paste include/exclude paths`.
6. Go back and open `Frontmatter`, whose two sections divide by **topic** instead: `Title` for everything about the name you type — how it becomes a file name, and how it is kept as an alias or a `title` property when it cannot — then `Frontmatter properties` for what happens to the property block itself.

## Why a section names a whole command

The two folder merges are different operations, and most of their settings apply to exactly one of them. A single `Merge folder` heading over both of them read as though the settings underneath covered both, so a description naming one command looked like the other command was undocumented. The heading now matches the command palette entry word for word, which is the thing you can check against.

## How a page is laid out

- Where a page has a **template**
  - that template comes first, with the settings that shape what it produces underneath it.
- `Folder note` is the one deliberate exception
  - its location dropdown decides whether the templates apply at all — it disables the name row outright while the location is `Auto` — so it stays above them.

## Searching instead of navigating

Obsidian's own settings search reaches inside the pages. Type a setting's name into the search box at the top of the settings window and pick the result: the page it lives on opens with it.

That is usually the fastest route when you know what the setting is called — the pages are for when you do not, and want to see what a feature offers.
