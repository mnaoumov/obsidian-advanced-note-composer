[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Templates

Merged and split content can be wrapped in a **template**. Templates support tokens that are
filled in at merge/split time.

## Tokens

- `{{content}}` - the extracted or merged text (**required** in every non-empty template).
- `{{fromTitle}}` / `{{fromPath}}` - the source note's title / path.
- `{{newTitle}}` / `{{newPath}}` - the destination note's title / path.
- `{{date:FORMAT}}` / `{{time:FORMAT}}` - the current date / time, formatted with a
  [moment.js](https://momentjs.com/docs/#/displaying/format/) format string.

There are three template settings: **Merge template**, **Split template**, and
**Smart cut & paste template**. Empty templates fall back up the chain:
smart cut and paste falls back to split, which falls back to merge.

## Try it

The button below sets a **Merge template** that stamps a heading and date onto merged
content. Manual equivalent: paste the same
template into **Merge template** in **Settings → Advanced Note Composer**. Then run
`Merge current file with another file...` from any note and inspect the result.

```code-button
---
caption: Set a dated merge template, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { mergeTemplate: '\n\n## Merged from {{fromTitle}} ({{date:YYYY-MM-DD}})\n\n{{content}}' });
```

To restore the default, set the template back to `\n\n{{content}}`.

```code-button
---
caption: Restore the default merge template, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { mergeTemplate: '\n\n{{content}}' });
```
