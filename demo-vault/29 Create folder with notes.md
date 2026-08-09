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
<%*
tp.hooks.on_all_templates_executed(async () => {
  await app.fileManager.processFrontMatter(tp.config.target_file, (fm) => {
    fm.aliases = TOKENS.rawFolderName.split(' - ').map((a) => a.trim()).filter(Boolean);
  });
});
-%>
# <% TOKENS.folderName %>
```

Type `A - B` and the note gets:

```text
---
aliases:
  - A
  - B
---
```

Obsidian writes those properties itself, so the quoting and the formatting are never your problem,
and anything your template already declares is kept rather than replaced.

Splitting on `' - '` rather than `'-'` is what keeps `Well-known - B` two entries and not three;
`.trim()` drops the spaces around each part, and `.filter(Boolean)` drops empty ones. Want the parts
title-cased, or a different separator in some other case? That is another line of the same JavaScript.

**`tp.hooks.on_all_templates_executed` is not decoration.** Templater writes the rendered note *after*
your code has run, so a `processFrontMatter` call made outside the hook is overwritten by that write
and the properties silently disappear. The hook is what runs your change once the note has settled.

## Before it happens

Turn **Should ask before creating a folder** on to get a confirmation dialog showing the cleaned-up
folder name and every note about to be created — the one place you can see the difference between
what you typed and what you will get.
