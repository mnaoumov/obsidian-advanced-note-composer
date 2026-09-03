# Finding a setting

This plugin has a lot of settings, and a single long scroll through all of them is no way to find one. The settings tab opens instead as a short list of **pages** you navigate into.

## Try it

1. Open `Settings -> Advanced Note Composer`.
2. You get a list of pages rather than a wall of settings: `Merge`, `Split/extract`, `Select`, `Swap`, `Smart cut & paste`, `Frontmatter`, the folder pages, `Rename`, `Reorder` and `UI`.
3. Click `Merge`. Inside it, subheadings separate the settings by **which command they apply to** — `All merges` for the ones every merge honors, then `Merge file`, `Merge folder contents into a single file` and `Merge current folder with another folder`, and finally `Merge include/exclude paths` for the four path boxes that decide where the merge commands work and where they are offered.
4. Go back and try `Smart cut & paste`, which splits the same way: `Notice`, then one group per destination (`At cursor`, `To top of file`, `To bottom of file`), then its own `Smart cut & paste include/exclude paths`.
5. Go back and open `Frontmatter`, whose two groups divide by **topic** instead: `Title` for everything about the name you type — how it becomes a file name, and how it is kept as an alias or a `title` property when it cannot — then `Frontmatter` for what happens to the property block itself.

## Why a subheading names a whole command

The two folder merges are different operations, and most of their settings apply to exactly one of them. A single `Merge folder` heading over both of them read as though the settings underneath covered both, so a description naming one command looked like the other command was undocumented. The heading now matches the command palette entry word for word, which is the thing you can check against.

## How a page is laid out

- Where a page has a **template**
  - that template comes first, with the settings that shape what it produces underneath it.
- `Folder note` is the one deliberate exception
  - its location dropdown decides whether the templates apply at all — it disables the name row outright while the location is `Auto` — so it stays above them.

## Searching instead of navigating

Obsidian's own settings search reaches inside the pages. Type a setting's name into the search box at the top of the settings window and pick the result: the page it lives on opens with it.

That is usually the fastest route when you know what the setting is called — the pages are for when you do not, and want to see what a feature offers.
