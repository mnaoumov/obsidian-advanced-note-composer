[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Create folder with notes

Create a folder **and the notes inside it** in one step. A prompt asks for the folder name, cleans up
what you type, numbers the folder after its siblings, and fills it from a template.

The clean-up is the part worth seeing: surrounding and repeated whitespace collapses, leading and
trailing dots go, invalid characters are replaced, and each word is capitalized — except a word that
is already ALL CAPS, which is left alone so an acronym survives.

## Try it

1. Right-click the `Create example` folder and choose `Create folder with notes...`.
2. Type `api   TEST  x*y` — with a stray space at each end, deliberately messy — and press `Create`.
3. A folder called `2. Api TEST X_y` appears, holding one note named after it.

It became `2.` rather than `1.` because `1. Existing` is already there: the number is always one more
than the highest already in use.

Running the command from the **command palette** instead creates the folder in your vault's
`Files & Links > Default location for new notes`, so it works with no note open and never asks where
to put it. Right-click a folder whenever you want it somewhere else — that is the whole choice.

## Naming

**Create folder name template** (under `Create folder with notes` in the settings) decides the folder
name. The default is:

```text
{{index}}. {{safeFolderName}}
```

- `{{index}}` — one more than the highest number already used by a sibling. `{{index:000}}` pads it to
  `001`. Remove the token to stop numbering.
- `{{safeFolderName}}` — what you typed, cleaned up, **without** the number.
- `{{rawFolderName}}` — exactly what you typed, untouched.

## Several notes at once

**Create folder content template** decides what goes inside. Empty means one empty note named after
the folder. Start a line with `{{file}}` to begin a new note and name it with the rest of that line —
everything up to the next `{{file}}` line is that note's content. Try pasting this into the setting
and running the command again:

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

That produces two notes, and the **first one declared** is the one that opens.

Note the two spellings side by side: `{{folderName}}` is the folder's real final name **with** the
number (`2. Api TEST X_y`), while `{{safeFolderName}}` is the same name **without** it
(`Api TEST X_y`). That is what lets one note carry the numbered name as its title and the plain one
as an alias.

## Templater

This section needs the [Templater](https://github.com/SilentVoid13/Templater) plugin, which this vault
does not ship. The button installs it from the community store, turns **Should run templater on
destination file** on, and loads the multi-alias template below — no reload needed:

```code-button
---
caption: Install Templater and load the example
---
await require('/demoSetup.ts').setUpTemplaterExample(app);
```

Manual equivalent: install and enable **Templater** from **Settings → Community plugins**, then turn on
**Should run templater on destination file** in **Settings → Advanced Note Composer** and paste the
template below into **Create folder content template**.

With **Should run templater on destination file** on, each created note is handed to Templater. The
plugin substitutes its own tokens first, so they are available to Templater code too — and they are
bound to a `TOKENS` object:

```text
{{file}} {{safeFolderName}}.md
<% TOKENS.safeFolderName.toUpperCase() %> is folder number <% TOKENS.index %>.
```

Because those are real values rather than pasted text, `<% TOKENS.index + 1 %>` adds rather than
concatenates, and a folder name containing a quote cannot break the expression.

### Several aliases from one name

A name like `A - B` can become two separate `aliases` entries, and no setting is needed for it — the
splitting rule is just JavaScript, so it can be exactly the rule you want:

```text
{{file}} !.md
---
aliases: <% JSON.stringify(TOKENS.rawFolderName.split(' - ')) %>
---
# <% TOKENS.folderName %>
```

Type `A - B` and the note gets `aliases: ["A","B"]` — two entries, which is what Obsidian reads that
as. Splitting on `' - '` rather than `'-'` is what keeps `Well-known - B` two entries and not three.
Want the parts trimmed, title-cased, or a different separator in some other case? That is the same
one line with a `.map(...)` on it.

`TOKENS` works inside the properties block because it is declared before everything else in the note,
and the declaration itself never reaches the file — which is also why `tp.frontmatter` still reports
this note's real properties.

For more control, *write* the properties instead of printing them. Obsidian then owns the YAML, so a
part containing a `:` or a quote is still formatted correctly, and properties your template already
declares are merged rather than replaced:

```text
{{file}} !.md
<%*
await app.fileManager.processFrontMatter(tp.config.target_file, (fm) => {
  fm.aliases = TOKENS.rawFolderName.split(' - ');
});
-%>
# <% TOKENS.folderName %>
```

which gives a proper list:

```text
---
aliases:
  - A
  - B
---
```

A plain `processFrontMatter` like that needs care in Templater generally. Wherever Templater *rewrites
a whole note* from what it read before your code ran — creating a note from a template, or replacing
the templates in a file — the rendered text lands on top of your write and the properties are lost,
which is why `tp.hooks.on_all_templates_executed` exists. Inserting a template into a note you already
have open is unaffected, because that writes through the editor, and so is writing properties to some
*other* file.

Creating a folder with notes is a rewriting flow, but the plugin owns that write and keeps whatever
properties your template set while it ran — so the plain call is enough here. The hook still works if
you prefer it.

## Before it happens

Turn **Should ask before creating a folder** on to get a confirmation dialog showing the cleaned-up
folder name and every note about to be created — the one place you can see the difference between
what you typed and what you will get.

It is also where you can move the folder somewhere else. The parent is decided before you are asked —
it is the folder you right-clicked, or Obsidian's own `Default location for new notes` when you ran
the command from the palette — so `Change target` (or `Alt+C`) opens a folder picker. Everything is
recomputed for the folder you pick, the numbering included: `{{index}}` counts the NEW parent's
children, so the previewed name is always the one you will actually get. Dismissing the picker keeps
the parent you had.

### Fixing a name from the dialog

Seeing the difference is only half of it — a `Rename` button sits beside the folder name and beside
every note in that list, so you can correct one without cancelling and starting over.

1. Paste the two-note template from [Several notes at once](#several-notes-at-once) into **Create
   folder content template**, turn **Should ask before creating a folder** on, and run the command on
   `Create example`.
2. Type `api TEST` and press `Create`. The dialog previews `2. Api TEST` holding `!.md` and
   `Api TEST.md`.
3. Press `Rename` beside `Api TEST.md` and call it `Overview`. Only that row changes.
4. Press `Rename` beside the folder name and call it `Reference`. The whole preview is rebuilt —
   the folder becomes `2. Reference`, `{{folderName}}` in the notes follows it, and `Overview.md`
   **keeps** the name you gave it.

That last point is the rule: a name you typed yourself is never re-derived behind your back — not by
a folder rename, not by `Change target`. Everything else still comes from the templates.

Each prompt opens on the name it is about, so a small edit is a small edit. Dismissing one means
"never mind". A note name is refused if it would be empty, if it still holds invalid characters (with
**Should replace invalid title characters** off), or if another note in the folder already has it —
so what the dialog shows is always what gets created.
