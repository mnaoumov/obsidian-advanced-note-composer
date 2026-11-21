# Advanced Note Composer

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-note-composer)](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases) [![Obsidian downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%27advanced-note-composer%27%5D.downloads&label=Obsidian%20downloads)](https://community.obsidian.md/plugins/advanced-note-composer) [![Minimum Obsidian version](https://img.shields.io/github/manifest-json/minAppVersion/mnaoumov/obsidian-advanced-note-composer?label=Obsidian)](https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/main/manifest.json) [![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-note-composer)

Obsidian's core [`Note composer`](https://help.obsidian.md/plugins/note-composer) moves text between notes, but it moves it bluntly: relative links come out pointing at nothing, a heading whose title contains a character a file name cannot hold is refused outright, and extracted text is always appended to the target — you never get to say where it lands. This [Obsidian](https://obsidian.md/) plugin fixes those, and then goes considerably further: whole folders can be merged, split, flattened, reordered and renamed; a selection of notes and folders can be bulk renamed with find and replace, case changes and numbering; a note's heading hierarchy can become a folder tree; and a selection can be marked in one note and dropped at an exact cursor position in another.

<!-- markdownlint-disable MD033 -->

<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-desktop-1.png"><img src="images/screenshots/screenshot-desktop-1.png" alt="Split a note into one file per heading, nested" width="600"></a>

<details>
<summary>More screenshots</summary>

<div>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-desktop-2.png"><img src="images/screenshots/screenshot-desktop-2.png" alt="Extract a heading into its own note, linked in place" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-desktop-3.png"><img src="images/screenshots/screenshot-desktop-3.png" alt="Reorder a note by moving whole sections" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-desktop-4.png"><img src="images/screenshots/screenshot-desktop-4.png" alt="Rename a heading and every link to it" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-desktop-5.png"><img src="images/screenshots/screenshot-desktop-5.png" alt="Merge this note into another" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-mobile-1.png"><img src="images/screenshots/screenshot-mobile-1.png" alt="Split a note into one file per heading, nested" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-mobile-2.png"><img src="images/screenshots/screenshot-mobile-2.png" alt="Extract a heading into its own note, linked in place" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-mobile-3.png"><img src="images/screenshots/screenshot-mobile-3.png" alt="Reorder a note by moving whole sections" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-mobile-4.png"><img src="images/screenshots/screenshot-mobile-4.png" alt="Rename a heading and every link to it" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-note-composer/blob/HEAD/images/screenshots/screenshot-mobile-5.png"><img src="images/screenshots/screenshot-mobile-5.png" alt="Merge this note into another" width="270"></a>
</div>

</details>

<!-- markdownlint-enable MD033 -->

## Demo vault

**The documentation is an interactive demo vault.** Every feature has a note that explains what it does and why you would want it, and walks you through it step by step — most of them with a button that sets the relevant setting for you so you can try it immediately.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on `GitHub` with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **`Advanced Note Composer`: Open demo vault** command.
2. Downloading `advanced-note-composer-demo-vault.zip` from the [Releases](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases). It unzips into a single `advanced-note-composer-demo-vault-<version>` folder.
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## What it does

Each row is one family of commands; its link opens the demo-vault section that walks through every one of them.

| Capability | In one line |
| --- | --- |
| [Merge](<./demo-vault/01 Merge/README.md>) | A note into another, a folder into a folder, several notes at once, or a folder tree into one file, with frontmatter reconciled and attachments carried along; an attachment note back into its parent |
| [Extract](<./demo-vault/02 Extract/README.md>) | A selection, a heading, the block between horizontal rules, or everything before or after the cursor into its own note, leaving a link, an embed or nothing; an embedded attachment into a note of its own |
| [Split](<./demo-vault/03 Split/README.md>) | A note by heading level, or its whole heading hierarchy into a folder tree, optionally auto-numbered |
| [Headings](<./demo-vault/04 Headings/README.md>) | Reorder, re-nest and number a note's sections, or rename a heading and have its links follow |
| [Swap](<./demo-vault/05 Swap/README.md>) | Two files, two folders or two selections trade places in one reversible operation |
| [Folder operations](<./demo-vault/06 Folder operations/README.md>) | Flatten, move, create from a template, reorder and renumber, or rename a folder with its folder note; bulk rename a selection of notes and folders |
| [Smart cut & paste](<./demo-vault/07 Smart cut and paste/README.md>) | Mark a selection or a heading, then drop it at an exact cursor position in any note |
| [Include / exclude paths](<./demo-vault/08 Include and exclude/README.md>) | Per command category, what the plugin may touch and where its commands are offered |
| [Titles, links and frontmatter](<./demo-vault/09 Titles, links and frontmatter/README.md>) | Links keep resolving, invalid title characters are cleaned up, and content can be wrapped in a template |
| [UI](<./demo-vault/10 UI/README.md>) | Minimizable dialogs, a changeable target, operation notices, and command menu placement |
| [Select](<./demo-vault/11 Selection/README.md>) | Commands that only set the selection, for the phone, where selecting by hand fails |

On desktop, for a vault kept in a `git` repository, the opt-in `Should commit bulk operations` setting records each folder-wide command and each recursive split as its own `git` commit, so `git revert` undoes it, and the `Undo a bulk operation...` command does that for you. See [Settings](<./demo-vault/10 UI/36 Settings.md>).

Merges also preserve keys from `Permanent Links` when it is enabled: see [Merge file](<./demo-vault/01 Merge/01 Merge file.md>).

## See also

[My other Obsidian resources](https://mnaoumov.dev/obsidian/)

| Plugin | Features | How `Advanced Note Composer` differs |
| --- | --- | --- |
| [`Advanced Merger`](https://community.obsidian.md/plugins/advanced-merger) | Merges a folder into one export document | Overlaps on folder merging; subfolders become headings; the result stays a vault note |
| [`Dualyze Structure`](https://community.obsidian.md/plugins/dualyze-structure) | Splits each `##` section into a note; `parent` property; index note; `Mermaid` knowledge map | Overlaps on splitting by heading; any heading level or the whole hierarchy; no map |
| [`Index Note Splitter`](https://community.obsidian.md/plugins/index-note-splitter) | Linked section notes; source becomes an index | Overlaps on splitting; link, embed or nothing in place of each part |
| [`Link Maintainer`](https://community.obsidian.md/plugins/link-maintainer) | Updates block references after text is moved to another note | Covers part of it: heading and block links follow every split, extract and merge automatically |
| [`Merge And Open Target`](https://community.obsidian.md/plugins/merge-open-target) | Merges a note or a selection into another and opens it; AI target suggestions | Overlaps on merging; also folders and frontmatter strategies; no AI suggestions |
| [`Merge as Alias`](https://github.com/Quietbyday/obsidian-merge-as-alias) | Merges a note and adds its name to the target's aliases; links keep the old name as text | Overlaps on merging; links keep the old name as text too; does not add an alias |
| [`Merge Notes`](https://community.obsidian.md/plugins/merge-notes) | Merges selected notes | Broader merge scope: folders, frontmatter strategies and attachments |
| [`Note Refactor`](https://community.obsidian.md/plugins/note-refactor-obsidian) | Extracts selections; splits notes | Broader editing scope: also merges, swaps and moves notes, folders and selections |
| [`Note Refactor Next`](https://community.obsidian.md/plugins/note-refactor-next) | Maintained `Note Refactor` continuation; extraction and splitting | Broader editing scope: also merges, swaps and moves |
| [`Note Refactor Plus`](https://community.obsidian.md/plugins/note-refactor-plus) | Named extraction profiles; per-profile templates, folders, names and link styles | Overlaps on extraction; one extraction configuration; also merges, swaps and moves |
| [`Note Splitter`](https://community.obsidian.md/plugins/note-splitter) | Splits notes at a delimiter | Alternative splitting: headings; optional recursive folder tree |
| [`Notes Merger`](https://community.obsidian.md/plugins/notes-merger) | Merges notes listed in an index | Alternative merge inputs: notes, folders and selections |
| [`Power Merge Notes`](https://community.obsidian.md/plugins/power-merge-notes) | Heading-wise merge; frontmatter and `Dataview`; duplicate cleanup | Overlaps on merging; also extracts, splits and swaps |
| [`SimpleMerge`](https://community.obsidian.md/plugins/simple-merge) | Compiles the notes an index links into one document; live re-sync | Alternative merge inputs: notes, folders and selections; the merge moves content rather than compiling a copy |
| [`Split by Heading`](https://community.obsidian.md/plugins/split-by-heading) | One note per heading of a chosen level; merges linked notes back | Overlaps on splitting by heading; also a recursive folder tree; merges back one note at a time |
| [`Splitsmith`](https://community.obsidian.md/plugins/splitsmith) | Splits by heading, delimiter, cursor or selection; AI cut suggestions; checks the split rebuilds the original | Overlaps on splitting and extraction; also merges, swaps and moves; no AI |
| [`Text Mover`](https://community.obsidian.md/plugins/text-mover) | Moves text under a heading of this or another note, or into a daily note | Overlaps on moving text; drops it at a cursor or the top or bottom of a note, not under a picked heading |
| [`Text Transporter`](https://community.obsidian.md/plugins/obsidian42-text-transporter) | Copies, moves and links text, lines and blocks | Overlaps on text moves; also handles whole notes, headings and folders |

Last searched for similar plugins on 2026-11-21.

## Installation

The plugin is available in [the official Community Plugins repository](https://community.obsidian.md/plugins/advanced-note-composer).

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-note-composer).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin (id: `advanced-note-composer`) are hidden.

If you need to enable them refer to the [documentation](https://mnaoumov.dev/obsidian-lib/guides/debugging/).

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING](./CONTRIBUTING.md) to get set up.

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

### Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/obsidian-advanced-note-composer/issues/new/choose), not as blank issues.

To report a bug from inside Obsidian, run the **`Advanced Note Composer`: Report a bug** command. It opens the bug form with the plugin version, the Obsidian version and your operating system already filled in.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/obsidian-advanced-note-composer/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the plugin version, the Obsidian version and your operating system.

## License

© [Michael Naumov](https://github.com/mnaoumov/)
