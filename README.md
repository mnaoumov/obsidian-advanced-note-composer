# Advanced Note Composer

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov)
[![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-note-composer)](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-advanced-note-composer/total)](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases)
[![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-note-composer)

Obsidian's core [`Note composer`](https://help.obsidian.md/plugins/note-composer) moves text between
notes, but it moves it bluntly: relative links come out pointing at nothing, a heading whose title
contains a character a file name cannot hold is refused outright, and extracted text is always
appended to the target — you never get to say where it lands. This
[Obsidian](https://obsidian.md/) plugin fixes those, and then goes considerably further: whole
folders can be merged, split, flattened, reordered and renamed; a note's heading hierarchy can become
a folder tree; and a selection can be marked in one note and dropped at an exact cursor position in
another.

## Demo vault

**The documentation is an interactive demo vault.** Every feature has a note that explains what it
does and why you would want it, and walks you through it step by step — most of them with a button
that sets the relevant setting for you so you can try it immediately.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on GitHub
with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **Advanced Note Composer: Open demo vault** command.
2. Downloading `advanced-note-composer-demo-vault-<version>.zip` (`<version>` is the release version)
   from the [Releases](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases).
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## What it does

- **Merge** — a note into another, a folder into a folder, several selected notes at once, or a whole
  folder tree down into one file, with frontmatter reconciled by a strategy you choose and
  attachments carried along.
  [Merge file](<./demo-vault/01 Merge file.md>) ·
  [Merge folder](<./demo-vault/02 Merge folder.md>) ·
  [Merge folder into single file](<./demo-vault/23 Merge folder into single file.md>) ·
  [Merge multiple files](<./demo-vault/24 Merge multiple files.md>) ·
  [Frontmatter merge strategy](<./demo-vault/13 Frontmatter merge strategy.md>)
- **Extract** — a selection, a heading and everything under it, the block between two horizontal
  rules, or everything before or after the cursor — leaving a link, an embed, or nothing behind.
  [Extract selection](<./demo-vault/03 Extract selection.md>) ·
  [Extract heading](<./demo-vault/04 Extract heading.md>) ·
  [Extract between horizontal rules](<./demo-vault/16 Extract between horizontal rules.md>) ·
  [Text after extraction](<./demo-vault/05 Text after extraction.md>)
- **Split** — by heading level, or recursively, turning a whole note's heading hierarchy (or one
  section of it) into a folder tree. The picker says up front whether you are creating a note or
  merging into an existing one.
  [Split by headings](<./demo-vault/06 Split by headings.md>) ·
  [Split into folder](<./demo-vault/25 Split into folder.md>) ·
  [Split headings recursively](<./demo-vault/27 Split headings recursively.md>) ·
  [Create or merge when splitting](<./demo-vault/33 Create or merge when splitting.md>)
- **Swap** — two files, two folders, or two selections trade places in one reversible operation.
  [Swap file](<./demo-vault/07 Swap file.md>) ·
  [Swap folder](<./demo-vault/08 Swap folder.md>) ·
  [Swap selections](<./demo-vault/20 Swap selections.md>)
- **Folder operations** — flatten a folder into its parent, move one somewhere else, create a folder
  and its notes from a template, reorder folders and renumber them, or rename one and keep its folder
  note in step.
  [Flatten folder](<./demo-vault/17 Flatten folder.md>) ·
  [Move folder to](<./demo-vault/18 Move folder to.md>) ·
  [Create folder with notes](<./demo-vault/29 Create folder with notes.md>) ·
  [Reorder folders](<./demo-vault/30 Reorder folders.md>) ·
  [Rename folder](<./demo-vault/31 Rename folder.md>)
- **Smart cut & paste** — mark a selection or a whole heading, then drop it at an exact cursor
  position in any note, including the one you took it from.
  [Smart cut and paste](<./demo-vault/09 Smart cut and paste.md>)
- **Titles, links and frontmatter** — relative links are rewritten so they keep resolving, invalid
  title characters are cleaned up (or mapped by a template of your own) instead of refused, a title
  containing `/` can become a real path, and merged or split content can be wrapped in a template.
  [Relative links](<./demo-vault/10 Relative links.md>) ·
  [Invalid titles](<./demo-vault/11 Invalid titles.md>) ·
  [Treat title as path](<./demo-vault/12 Treat title as path.md>) ·
  [Templates](<./demo-vault/14 Templates.md>)
- **Headings** — reorder a note's sections, or rename a heading and have its backlinks follow.
  [Reorder headings](<./demo-vault/19 Reorder headings.md>) ·
  [Rename heading](<./demo-vault/22 Rename heading.md>)
- **Include / exclude paths** — two independent filters: what the plugin may touch, and where its
  commands are offered at all.
  [Block commands on excluded paths](<./demo-vault/21 Block commands on excluded paths.md>)
- **UI** — every dialog can be minimized, and every one of them can be pointed at a different target
  without cancelling the operation;
  operations report what they are doing; and the settings tab is a short list of pages rather than one
  long scroll.
  [Minimizing dialogs](<./demo-vault/15 Minimizing dialogs.md>) ·
  [Operation notices](<./demo-vault/28 Operation notices.md>) ·
  [Change target](<./demo-vault/34 Change target.md>) ·
  [Finding a setting](<./demo-vault/35 Finding a setting.md>)

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

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING](./CONTRIBUTING.md) to get set up.

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
