# Advanced Note Composer

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

## Treat Title As Path

`Treat title as path` option allows you to treat header as path when they contain `/`. This means that if a header with `/` is being extracted or merged, then the path it will be merged to is the name of the header.

For example, assume we have a header `## a / b / c / d`.

If Treat title as path option is

- enabled - the split file will be a/b/c/d.md
- disabled - the split file will be a _ b _ c _ d.md

Its important to make sure that you have spaces in between `/` characters in your header, so this option works correctly.

❌: `## heading/abc/def`

✅: `## heading / abc / def`

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

For more details, refer to the [documentation](https://github.com/mnaoumov/obsidian-dev-utils/blob/main/docs/debugging.md).

## Support

<!-- markdownlint-disable MD033 -->
<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>
<!-- markdownlint-enable MD033 -->

## License

© [Michael Naumov](https://github.com/mnaoumov/)
