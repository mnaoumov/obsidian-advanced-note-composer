# Advanced Note Composer

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov)
[![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-note-composer)](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-advanced-note-composer/total)](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases)
[![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-note-composer)

This [Obsidian](https://obsidian.md/) plugin extends the core [`Note composer`](https://help.obsidian.md/plugins/note-composer) plugin fixing some bugs and adding additional features.

## Relative links

If you use `Merge current file with another file...`, `Extract current selection...`, `Extract this heading...` from the note with relative links, the core plugin moves those links as is, which leads to broken links you have to fix manually.

The current plugin adjusts such links and makes them valid.

## Invalid titles

Sometimes when you extract selection or heading, the chosen title is invalid

```md
# Title with invalid characters *\<>:|?#^[]"
```

The core plugin will show an error when you try to extract such heading.

The current plugin allows to replace/remove such invalid characters.

If those invalid characters were used intentionally, the plugin allows to add the invalid title

- to the note alias (to be able to access it from the `Quick switcher`).
- to the frontmatter title key.

## Treat title as path

`Treat title as path` option converts titles that contain `/` into paths.

For example, when we invoke `Extract this heading...` command for `## a / b / c / d`:

If `Treat title as path` option is

- **enabled** - the split file will be `a/b/c/d.md`. Leading and trailing spaces are trimmed.
- **disabled** - the split file will be `a _ b _ c _ d.md`. Spaces are preserved. `/` is replaced with `_` (or another replacement string as per settings).

## Extract between horizontal rules

The core plugin can only extract a heading's section or an explicit selection. When you keep a long note
divided by horizontal rules (`---`, `***`, `___`, and their spaced/longer variants such as `- - -`), the
**`Extract between horizontal rules...`** command extracts the block **between the rules closest to the
cursor** in one step — no manual selection, which is especially handy on mobile.

- The note's start and end act as implicit boundaries: with the cursor above the first rule it extracts
  from the note start to that rule; below the last rule, from that rule to the note end.
- The bounding rules themselves stay in place — only the content between them is moved.
- If the cursor is on a rule line, the block *below* that rule is extracted.
- The command is unavailable in a note that contains no horizontal rules.

It runs the same extraction workflow as the other `Extract …` commands (target picker, relative-link
fixing, footnotes, frontmatter, templating, and the *Text after extraction* residual). Horizontal rules are
detected via Obsidian's own parser, so `---` inside a code block and the frontmatter delimiters are never
mistaken for a rule.

## Extract properties as properties

Selecting a couple of values inside a note's properties (its frontmatter) and running
`Extract current selection...` used to paste those raw YAML lines into the destination note's **body**,
where they are just text. With **`Should extract a properties selection as properties`** (on by default),
a selection that lies entirely inside the properties block is instead merged into the destination note's
own properties, through the same `Frontmatter merge strategy` every other merge uses.

The selection is a set of **values**, not whole properties, so the property each value belongs to is carried
across with it: selecting two `aliases` values

```yaml
---
aliases:
  - alpha
  - bravo
  - charlie
tags:
  - keep
---
```

adds `alpha` and `bravo` to the destination's own `aliases`, and leaves the source with `charlie` and its
`tags` intact.

- Every property line the selection touches is taken **in full**, so a selection that starts halfway through
  a value still moves that whole value.
- A property left with no values of its own is removed from the source too, rather than being left dangling.
- Everything the selection did not touch is kept byte for byte — comments, key order, quoting and
  indentation style all survive.
- `Text after extraction` is not applied: a link or an embed is not valid YAML.
- Anything else falls back to the previous behavior — a selection that reaches out of the properties block,
  or lines that do not parse into properties, is extracted as raw text.
- Smart cut & paste moves are unaffected: they insert at the cursor you place in the note's body.
- Extracting a note's properties into that same note is refused — they are already there.

## Move selection to another note (smart cut & paste)

The core `Extract current selection...` command moves a selection into another note in one step, always
appending/prepending it to that note. This plugin adds a decoupled, two-step **move** that lets you drop
the selection at an exact cursor position in any note (including the same note), while still running the
full extraction workflow (relative-link fixing, footnotes, frontmatter, templating).

Commands (each appears as **`Smart cut & paste: …`** in the command palette):

- **`Mark selection to move`** — available when there is a selection. Records the selection and its note,
  and locks that note (blocking edits) so the marked region cannot drift before you move it. The note stays
  unchanged — nothing is removed yet. Enable **Should lock all notes when marking selection** to lock *every*
  note (not just the source) while a mark is held, so you must finish the extraction before editing anything.
- **`Move marked selection here`** — available once something is marked. Moves the marked selection to the
  cursor in the current note, using your default settings, as a single reversible operation. If you have
  text selected in the target when you run it, the moved text **replaces that selection** (like pasting over
  a selection); with no selection, it is inserted at the cursor.
- **`Move marked selection here (advanced)...`** — same, but first prompts for the frontmatter merge
  strategy, whether to fix footnotes / include frontmatter, and the text to leave in place of the moved
  text (see **Text after extraction** below).
- **`Move marked selection to top of file`** / **`Move marked selection to bottom of file`** — available
  once something is marked. Move the marked selection to the top (just after any frontmatter) or bottom of
  the current note, regardless of the cursor position. These ship with **no default hotkeys** — bind your
  own in Obsidian's *Hotkeys* settings (for example `Shift+Enter` / `Enter`) for quick keyboard extraction.
- **`Cancel move`** — available once something is marked. Discards the mark and unlocks the note(s)
  without moving anything. The built-in `Unlock active note` command (available on any locked note), or
  right-clicking a note's lock indicator, cancels the whole pending move the same way.

While a selection is marked, a persistent **Smart cut & paste** notice reminds you that a move is pending
until you complete or cancel it. The notice carries buttons — **Move marked selection to top of file**,
**Move marked selection to bottom of file**, **Move marked selection at cursor**, and **Cancel move** —
each enabled only while it applies to the active note, so you can drive the whole move from the notice
without opening the command palette.

The **Smart cut & paste** settings group lets you tailor this notice:

- **Should show smart cut & paste notice** — turn the whole notice off if you prefer to drive marking,
  moving, and cancelling purely through the commands (and their hotkeys). Nothing is shown when a
  selection is marked.
- **Should show move to top of file button** / **Should show move to bottom of file button** /
  **Should show move at cursor button** — hide any of the three move buttons you do not use, leaving a
  tidier notice. **Cancel move** is always shown. Hiding a button never unregisters its command, so any
  hotkey you assigned to it keeps working.
- **Should jump to content moved to top of file** / **Should jump to content moved to bottom of file**
  (both on by default) — whether the cursor follows the marked selection to where it lands. Turn one off
  when you use that move to get text *out of the way*: the cursor then stays where the selection was cut
  from, so you keep your place. There is deliberately no such setting for `Move marked selection here` /
  `at cursor` — inserting text at the cursor and then leaving the cursor somewhere else makes no sense,
  so that move always jumps.
- **Smart cut & paste completion feedback** (`Select moved content` by default) — how a finished move
  shows you where the marked selection landed. `Select moved content` selects the moved text (the
  original behavior). `Notice` puts the cursor on the moved text *without* selecting it and shows a
  notice instead — useful because a selection in the target looks exactly like the highlight on a
  selection that is still marked and waiting to be moved, which is hard to tell apart, especially while
  the notes are locked. `Select moved content and notice` does both. The cursor travels either way; this
  only changes how the landing is shown, and none of it happens when the move's jump is turned off above.
- **Smart cut & paste template** — the template applied to the pasted text when you move a marked selection
  at the cursor (`Move marked selection here` / `at cursor`), so a smart-cut paste can be formatted
  differently from an ordinary split into a new note. It is *also* the template `to top of file` and
  `to bottom of file` use, unless you give that direction its own template below. Supports the same tokens
  as the other templates (`{{content}}`, `{{fromTitle}}`, `{{fromPath}}`, `{{newTitle}}`, `{{newPath}}`,
  `{{fromParentFolder}}`, `{{newParentFolder}}` / `{{parentFolder}}`, `{{date:FORMAT}}`). Leave it empty to
  reuse the **Split template** (which itself falls back to the **Merge template**), preserving the previous
  behavior.
- **Smart cut & paste template (to top of file)** / **Smart cut & paste template (to bottom of file)**
  (both empty by default) — per-direction overrides, so a move to the top can be formatted differently from
  a move to the bottom or at the cursor. This is what makes something like "always leave a blank line after
  the frontmatter, but only when moving to the top" expressible. Leave one empty to keep using
  **Smart cut & paste template** for that direction — which is exactly the behavior before these settings
  existed, so an existing configuration is unaffected. The full resolution order is:

  ```text
  at cursor  →  Smart cut & paste template                                              →  Split → Merge
  to top     →  Smart cut & paste template (to top of file)    → Smart cut & paste template → Split → Merge
  to bottom  →  Smart cut & paste template (to bottom of file) → Smart cut & paste template → Split → Merge
  ```

  There is deliberately no separate template for `at cursor`: **Smart cut & paste template** *is* its
  template, and simultaneously the fallback for the other two.

The captured selection is also **persistently highlighted in the source note** so you always see exactly
what will be moved. This applies both while a smart-cut selection is marked and while an `Extract …` /
split picker is open (the selection stays highlighted while you choose the target). The highlight clears
when the operation completes or is cancelled.

Notes:

- **Switch to smart cut from the split picker.** Because splitting and smart cut share the same setup, the
  `Extract …` picker shows a **Switch to smart cut & paste** button (or press `Alt+S`) that switches to smart
  cut & paste instead of splitting: the picker closes, your selection is marked to move, and the note
  highlighted in the picker opens so you can position the cursor and paste. The same **Switch to smart cut &
  paste** button also appears on the split confirmation dialog (when *Ask before splitting* is on), so you
  can switch after the target is chosen.

- **Change target from a confirmation dialog.** Every confirmation dialog that follows a target picker shows a
  **Change target** button (or press `Alt+C`) that sends you back to the picker to pick a different target —
  without cancelling and re-triggering the whole operation. This applies to the split confirmation dialog
  (when *Ask before splitting* is on), to the merge-file and merge-folder confirmation dialogs (when *Ask
  before merging* is on), and to the swap-file and swap-folder confirmation dialogs (when *Ask before
  swapping* is on). For the split and merge-file pickers, the reopened picker is preselected with your
  previous choice.

- **Switch to split/extract from the notice.** The reverse switch: the **Switch to split/extract** button on
  the Smart cut & paste notice (or the `Smart cut & paste: Switch to split/extract` command) re-opens the
  source note with the selection restored and opens the split/extract picker, so you can search for a target
  and split into it with the full option set.

- The move only removes the text from the source note when you run the paste, so footnotes, links, and
  frontmatter are still resolved from the intact source.
- When the target is the same note as the source, `Move marked selection here` is unavailable while the
  cursor is inside the marked selection (and the top/bottom commands are unavailable when the top would
  land inside a selection that spans the note's frontmatter).
- **Same-note extraction from the picker.** The `Extract current selection...` / `Extract this heading...`
  pickers now also offer the *current* note as a target, so you can extract a selection to the top or
  bottom of the same note: press `Enter` (bottom) or `Shift+Enter` (top) on the current note in the picker.
- **Same-note moves and *Text after extraction*.** The **Text after extraction** setting decides what is
  left in place of the extracted text (a link to the target note, an embed, or nothing). When you move
  within the *same* note, a link/embed pointing at the note itself is meaningless, so by default the
  moved text is simply removed. Enable **Apply text after extraction to the same file** to apply the
  setting to same-note moves anyway, or override it per move in the advanced command.

## Split into folder

Turn on **Should split into folder** (under `Split/extract` in the settings) to have every split or extract that creates a **new** note place it inside a brand-new folder named after the note. The note lands at `<folder>/<note>/<note>.md` instead of `<folder>/<note>.md`, keeping each extracted note tidily grouped with its own folder (handy when you later add attachments or child notes next to it). The folder name is de-duplicated if one already exists, links/footnotes are fixed exactly as for an ordinary split, and splitting/extracting into an **existing** note is unaffected. When the setting is off (the default), behavior is unchanged.

**Split into folder note name** (right below it) decides what the note inside that folder is called. Leave it empty — the default — and the note keeps the folder's name (`<folder>/<note>/<note>.md`). Set it to a constant such as `Overview` and every folder split produces `<folder>/<note>/Overview.md` instead, so all your split-created notes are named consistently. It accepts the same `{{...}}` tokens as the templates (`{{newTitle}}` is the folder name, so `{{newTitle}} index` gives `<folder>/<note>/<note> index.md`), except `{{content}}`, which is meaningless in a file name. The name the note would otherwise have had is not lost: it is recorded as an alias and/or a frontmatter `title` exactly as any other adjusted title is, per **Should add invalid title to note alias** and **Frontmatter title mode** — so links written by that name keep resolving. The setting has no effect while **Should split into folder** is off.

## Split headings automatically

Turn on **Should split headings automatically** (under `Split/extract` in the settings) to make heading-driven splits run immediately, with no target picker and no confirmation dialog. It covers `Split note by headings - H1`…`H6`, their `content` variants, and `Extract this heading...`; each new note is named after the heading it came from. Combine it with **Should split into folder** to get exactly one folder per heading, named after that heading. When the setting is off (the default), these commands keep asking, as configured by **Should ask before splitting** — and that setting still governs ordinary, manually-targeted splits either way.

## Split headings recursively

The `Split note by headings recursively...` command turns a note's whole heading hierarchy into a folder tree in one go: every heading becomes a folder named after it, containing a note of the same name, and a sub-heading becomes a folder inside its parent's folder. A note with `# A`, `## B`, `### C` and `## D` therefore yields `A/A.md`, `A/B/B.md`, `A/B/C/C.md` and `A/D/D.md`. Each note keeps its own heading and body text, while the sections nested under it move into their own notes — and the usual **Text after extraction** residual is left behind, so each note links down to its children and the tree stays navigable. Anything before the first heading stays in the original note, which links to the top-level notes.

Every note it creates is wrapped in the **Split template** (which falls back to the **Merge template**), exactly like an ordinary split into a new note — so you control what appears in each of them. The template is applied to a note only once its own sub-headings have moved into their own notes, which is what keeps it out of the notes below: a template that writes something *after* `{{content}}` (a footer, a backlink, a `---` rule) sits under the note's last heading, so applying it any earlier would carry that text into the last child instead of leaving it where it belongs. `{{fromTitle}}` / `{{fromPath}}` therefore name the note directly above in the tree, not the note the command was invoked on. That original note is left as it is — it is the source, not a note the split produced — so it keeps whatever preceded the first heading plus the links down to the top-level notes.

Unlike `Split note by headings - H<n>`, this command is not tied to a level or to where your cursor is: it starts at the shallowest heading the note actually has and works its way down, so a note that jumps straight from `#` to `###` still nests correctly. It also builds the folder tree regardless of the **Should split into folder** setting — a recursive split without folders could not express a hierarchy — while that setting keeps governing ordinary splits as before. Because this restructures the whole note at once, it asks for confirmation once, up front, listing every note it is about to create (as configured by **Should ask before splitting**); the individual splits then run without further prompting.

By default the tree is built next to the note you split. Turn on **Should split recursively into the default new note folder** (under `Split/extract` in the settings) to have it built in Obsidian's own `Default location for new notes` instead — the same place `Extract selection` puts its note. Only the *top* of the tree moves there; everything below it still nests under its parent, so the hierarchy is preserved rather than flattened:

```text
Obsidian: Default location for new notes = Inbox
Source: Notes/Source.md   (# A / ## B / ### C / ## D)

setting off (the default)      setting on
  Notes/A/A.md                   Inbox/A/A.md
  Notes/A/B/B.md                 Inbox/A/B/B.md
  Notes/A/B/C/C.md               Inbox/A/B/C/C.md
  Notes/A/D/D.md                 Inbox/A/D/D.md
```

The note you split is never moved — it stays where it is and links down into the new tree. The setting affects no other command, and it has no visible effect while Obsidian's own setting is `Same folder as current file`, since that resolves to the very location the setting replaces.

## Which commands the editor menu offers

Right-clicking with text selected offers the commands that act on a **selection**; the ones that act on a heading or on the whole note step aside. Concretely, `Extract this heading...` and `Split note by headings recursively...` are not in the editor menu while a selection is active — `Extract current selection...` is the one you want there. Drop the selection and both are back.

This only affects the editor's right-click menu. The commands stay available in the command palette and through any hotkey you assigned, selection or not, so nothing you can do today stops working.

Two related rules are unchanged: `Split note by headings - H<n>` (and its `content` variant) is offered whenever the cursor or selection sits anywhere inside a heading of that level, and `Extract this heading...` — with nothing selected — works from anywhere inside a heading's section, not just from the heading line itself.

## Flatten folder

Flattening moves children of the chosen folder up one level, so they become siblings of that folder. Folders keep their internal structure (they are moved as a whole, not collapsed), links are updated automatically, and any name that would collide with an existing sibling is de-duplicated. The source folder is left in place; delete it manually if you no longer need it.

*What* moves is decided when you invoke the command, so there is nothing to configure. Three commands, each on a folder's right-click menu and in the command palette:

| Command | What it promotes |
| --- | --- |
| `Flatten folder...` | Every direct child — notes, attachments **and** sub-folders — moves up one level, leaving the folder empty. |
| `Flatten folder (child folders only)...` | Only the direct child folders move up. The folder keeps its own files and the attachment folder holding their attachments, so the folder itself stays intact. |
| `Flatten folder recursively (all folders at any depth)...` | Every folder at any depth under the chosen folder moves up to that folder's own level, so a whole sub-tree lands as one row of siblings. Each moved folder keeps its own files, and attachment folders stay with the notes they belong to. |

`Flatten folder...` kept the command id it has always had, so any hotkey you bound to it still works and still does exactly what it did before; the two other commands start unbound.

Because a flatten has no picker to review, it asks for confirmation first and lists every item it is about to move — including the de-duplicated name a colliding item will end up with. A nested item is listed by its path under the flattened folder, so two promoted folders that share a name are still told apart. Both the folder and its destination are clickable links that reveal that folder in the file explorer (the destination is always the folder's own parent, shown as `/` when that is the vault root). Turn **Should ask before flattening a folder** off, or tick `Don't ask again` in the dialog, to flatten straight away.

Attachments need no special handling in `Flatten folder...`: because every direct child moves, an attachment sitting beside a note travels with it and an attachment sub-folder moves as a whole, so embeds keep resolving. Attachments kept in a central attachment folder live outside the flattened folder and correctly stay where they are.

The two folder-only commands do have to be careful, because notes are staying behind. A child folder is left where it is when it holds the attachments of a note that is *not* moving with it, as resolved by Obsidian's own attachment-folder setting — which means an attachment-location plugin such as Custom Attachment Location is honoured too. Note the flip side: when your attachments live in the vault root or in one fixed folder, a folder you merely *named* `attachments` is not any note's attachment folder, so it is promoted like any other.

That is also why the two folder-only commands hide themselves when the only child folder they could promote is such an attachment folder: there would be nothing to move. The one exception is a vault running an attachment-location plugin — resolving the folder is then up to that plugin and cannot be answered while the menu is being built, so the commands stay listed and tell you nothing would move if you run one.

## Move folder to…

The `Move folder to...` command (also on a folder's right-click menu) moves the chosen folder into another folder you pick from a suggester. The picker respects the plugin's ignored paths and never offers the folder's own subtree or its current parent (moving there would be a no-op). Links are updated automatically and a name collision in the destination is de-duplicated.

After you pick a destination, a confirmation dialog shows the folder and where it is going; `Change target` sends you back to the picker. Both the source and the destination are clickable links that reveal that folder in the file explorer (the vault root is shown as `/`). Turn **Should ask before moving a folder** (under `Move/flatten folders` in the settings) off, or tick `Don't ask again` in the dialog, to move as soon as you pick a destination.

## Create folder with notes

The `Create folder with notes...` command (also on a folder's right-click menu) creates **a folder and the notes inside it** in one step. From the folder menu the new folder goes into the folder you right-clicked; from the command palette a picker asks where it should go (the vault root included). A prompt then asks for the folder name, and what you type is cleaned up before anything is created: surrounding whitespace and leading/trailing dots are dropped, runs of whitespace collapse to a single space, invalid characters are replaced per **Should replace invalid title characters** / **Replacement**, and the name is capitalized — the first letter of each word upper-cased and the rest lower-cased, except a word that is already entirely upper-case, so `api TEST` becomes `Api TEST`. Turn **Should capitalize the created folder name** off to keep your capitalization. A name that ends up empty is refused and the prompt asks again.

Two templates under `Create folder with notes` decide the rest:

- **Create folder name template** names the folder. The default `{{index}}. {{safeFolderName}}` numbers it after its siblings, so typing `notes` next to `1. Alpha` and `3. Beta` gives `4. Notes`. `{{index}}` is `1 + the highest number already in use`, so a gap is never backfilled and a deleted folder never causes a collision; which siblings count is derived from this very template, so changing the separator changes both halves at once. `{{index:000}}` zero-pads to the width of the mask. Leave `{{index}}` out to stop numbering altogether.
- **Create folder content template** decides the notes. Leave it empty for a single empty note named after the folder. To create several, start each one with `{{file}}` at the beginning of its own line, followed by the note name — everything up to the next `{{file}}` line is that note's content, and the first note declared is the one that opens (turn **Should open note after creating folder** off to stay where you are). A note name with no extension gets `.md`.

Both templates accept `{{index}}`, `{{rawFolderName}}` (exactly what you typed), `{{safeFolderName}}` (the cleaned-up name, **without** the number), `{{parentFolder}}`, `{{parentFolderPath}}`, `{{date:FORMAT}}` and `{{time:FORMAT}}`. The content template also accepts `{{folderName}}` and `{{folderPath}}` — the folder's real final name and path, number and any de-duplication suffix included. That distinction is the point: `{{folderName}}` is `2. Api TEST`, `{{safeFolderName}}` is `Api TEST`, so a note can carry one as its title and the other as an alias. They are rejected in the name template, which is what produces them.

```text
{{file}} !.md
---
title: "{{folderName}}"
aliases:
  - {{safeFolderName}}
---

- [ ] refine
{{file}} {{safeFolderName}}.md
# {{folderName}}
```

With **Should run templater on destination file** on, every created note is handed to [Templater](https://github.com/SilentVoid13/Templater) — and because the plugin's own tokens are substituted first, they are available to Templater code as well. They are also bound to a `TOKENS` object, so `<% TOKENS.safeFolderName %>` and `<% TOKENS.index + 1 %>` both work, and a name containing a quote cannot break the expression. A template pulled in with `tp.file.include(...)` is parsed separately and does not see `TOKENS`; pass what it needs through the note's own properties instead. A template that declares its own `TOKENS` will fail to run.

Turn **Should ask before creating a folder** (off by default) on to see a confirmation dialog first — it shows the cleaned-up folder name and every note about to be created, which is the one place the difference between what you typed and what you get is visible beforehand. The whole creation runs in one reversible, resource-locked transaction, so a cancellation or a failure leaves no half-built folder behind.

## Merge folder contents into a single file

The `Merge current folder contents into a single file...` command (also on a folder's right-click menu) concatenates **every note inside a folder** — recursively, a folder's own notes first and then each sub-folder's — into **one brand-new note** named after the folder and placed next to it. This is distinct from `Merge current folder with another folder...`, which mirrors the folder's structure into another folder; here everything collapses into a single file. Each note is run through the same merge pipeline as a single-file merge, so your **Merge template**, **frontmatter merge strategy**, footnote fixing, and link/backlink updates all apply. The whole batch runs in one reversible, resource-locked transaction (cancel or an external change rolls everything back), the merged source notes are deleted, and notes whose path is excluded/ignored are skipped and reported — unless **Should always merge excluded items** is on.

Four settings under `Merge folders` shape the result:

- **Merge folder into file note name** names the merged note. Leave it empty to keep naming it after the folder. It accepts `{{folderName}}`, `{{folderPath}}`, `{{parentFolder}}`, `{{date:FORMAT}}` and `{{time:FORMAT}}`, so every merge can produce e.g. `Docs summary.md`. The note is always created next to the folder, and a colliding name is de-duplicated.
- **Should convert folders to headings when merging a folder** mirrors the folder hierarchy as headings. A direct sub-folder becomes `# Name`, its own child `## Name`, and so on; notes directly inside the merged folder get no heading, since the merged note already stands for that folder. Every sub-folder is headed, including a completely empty one — the merged outline mirrors the whole tree, so an empty folder is still part of it. Two note-less cases are left out instead, because nothing of either was merged: a folder holding only attachments (and everything under it), and a folder whose notes exist but are all excluded. Each merged note's own headings are demoted to match, so the outline stays well-formed. This is the exact opposite of `Split note by headings recursively...`, which turns a heading hierarchy into a folder tree — split a note into a tree and merge it back and the levels agree. Markdown only defines six heading levels, so a folder more than six deep gets a `#######`-and-longer line that Obsidian shows as plain text rather than a heading; the level is still written out in full, because clamping everything to `######` made a folder and its own descendants indistinguishable.
- **Should move attachments when merging a folder** (on by default) carries the merged notes' attachments into the merged note's attachment folder, so nothing is stranded in a folder that is about to disappear. The destination comes from your vault's own attachment settings, which means [Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location) is honored when you have it installed. An attachment moves when one of the merged notes references it, or when it already sits where that note's attachments belong. Turn it off to leave attachments exactly where they are.
- **Empty folders after merging a folder** decides what happens to the folders the merge empties: `Delete` (the default) removes the merged folder and every emptied sub-folder, `Delete sub-folders only` keeps the merged folder itself — even once it is empty — while removing every emptied folder under it however deep, `Delete with empty parents` is `Delete` plus any parent the deletion leaves empty, and `Keep` leaves everything in place. A folder still holding files is always kept, and nothing is deleted if the merge is cancelled.

Markdown files that are really attachments are never merged: **Attachment extensions** (default `.excalidraw.md`) lists the extensions that mark them — written out in full, leading dot included — so an Excalidraw drawing — stored as `sketch.excalidraw.md` — keeps its raw payload out of the merged note and is relocated with the other attachments instead. The same applies to `Merge current folder with another folder...`: a drawing is moved into the destination folder like any other attachment (de-duplicated if one of the same name is already there) rather than merged into it.

## Attachments when merging files

**Should move attachments when merging a file** (under `Merge`, on by default) makes the attachments a note owns follow it when `Merge current file with another file...` merges that note away — otherwise they would be left behind in a folder the note no longer lives in. It applies to `Merge these files into one file...` too.

An attachment moves when the merged note references it and **no other note does**; an attachment several notes share belongs to none of them and stays where it is. The destination comes from your vault's own attachment settings, which means [Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location) is honored when you have it installed — this plugin never computes attachment paths itself. Attachments move inside the merge's own transaction, so cancelling the merge puts them back.

## Merge multiple selected files

Select two or more notes in the file explorer, right-click, and choose `Merge these files into one file...` to merge them all into a single target note at once (instead of merging one pair at a time). You pick the target from a suggester — your existing notes, with the selected notes excluded; to combine into a fresh note, create an empty note first and pick it. Each selected note is run through the same merge pipeline as a single-file merge (**Merge template**, **frontmatter merge strategy**, footnote fixing, link/backlink updates), the whole batch runs in one reversible, resource-locked transaction, the merged source notes are deleted, and notes whose path is excluded/ignored are skipped and reported — unless **Should always merge excluded items** is on. The item appears only when two or more markdown notes are selected.

## Include/exclude paths

The **Include paths** and **Exclude paths** settings (under `Include/exclude paths`) decide which notes and folders this plugin works on. `Include paths` restricts it to the listed paths — leave it empty and everything is included. `Exclude paths` marks the listed paths as ignored — leave it empty and nothing is excluded. Put one entry per line; each entry is either a path string or a `/regular expression/`.

The two forms match differently, and the difference is the thing worth knowing:

- A **path string** matches that note or folder **and everything inside it**. So `Inbox` covers `Inbox`, `Inbox/note.md` and `Inbox/sub/deep.md` alike. This is what you want most of the time.
- A **`/regular expression/`** is tested against the path exactly as written, with no subtree rule bolted on. That is how you match a folder *without* its contents: `/^Inbox$/` matches the `Inbox` folder itself and none of the notes in it. Likewise `/^Inbox\/[^/]+\.md$/` matches the notes directly inside `Inbox` but not the folder and not anything deeper.

A `/regular expression/` that does not parse is reported under the setting as `Invalid regular expression: …`, and while it is there **the whole list is ignored** — so a single broken entry stops the other entries in that box from matching until you fix it. Half-typed values are fine: nothing happens while you type, the message only tells you the entry as it stands is not usable yet.

Ignored paths are skipped by the pickers, and the folder/file batch commands (`Merge current folder contents into a single file...`, `Merge these files into one file...`) skip and report ignored notes — unless **Should always merge excluded items** is on.

By default the plugin's commands are still offered on an ignored path and only pop an "ignored in the plugin settings" notice when you trigger one. Turn **Should block commands on excluded paths** on to hide them entirely instead — they disappear from the command palette and from the editor, file, and folder context menus.

## Operation notices

Every operation this plugin runs reports itself: a notice while it is running — so you know when not to touch Obsidian — and a notice naming what it did once it finished. It covers merging, splitting and extracting, swapping, moving and flattening folders, renaming a heading, and reordering headings alike. The running notice appears only once an operation has been going for half a second, so quick ones never flash one up.

Turn **Should show operation notices** off (under `UI`) to silence both. Refusals and errors — "this path is ignored in the plugin settings" and the like — are always shown whatever this is set to.

One thing to know before turning it off: the running notice is what carries the operation's `Cancel` button, so hiding it hides that too. A long operation can still be cancelled by right-clicking the note's lock indicator and unlocking it.

Two related settings are deliberately separate and unaffected by this one: **Should show smart cut & paste notice**, which controls the *interactive* marked-selection notice (turning it off removes its buttons, not just information), and **Smart cut & paste completion feedback**, which already decides how a finished move announces itself.

## Minimizing dialogs

Every picker and confirmation dialog this plugin opens — the `Merge …`, `Extract …` (split), and `Swap …` pickers and their confirmation dialogs — can be **minimized** to a small floating bar so you can peek at the notes involved without dismissing the dialog. The bar has two buttons:

- **Restore** — reopens the dialog where you left off.
- **Cancel** — closes the dialog. For an operation that locks its note while the dialog is open (an extract/split or a merge), cancelling this way also **unlocks the note and cancels the operation** — the same effect as the built-in `Unlock active note` command or right-clicking the note's lock indicator, but reachable directly from the minimized bar.

## Demo vault

A demo vault with usage examples ships with every release. You can access it via any of the following:

1. Running the **Advanced Note Composer: Open demo vault** command.
2. Downloading `advanced-note-composer-demo-vault-<version>.zip` (`<version>` is the release version) from the [Releases](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases).
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## Installation

The plugin is available in [the official Community Plugins repository](https://obsidian.md/plugins?id=advanced-note-composer).

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-note-composer).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command:

```js
window.DEBUG.enable('advanced-note-composer');
```

For more details, refer to the [documentation](https://mnaoumov.dev/obsidian-dev-utils/guides/debugging/).

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
