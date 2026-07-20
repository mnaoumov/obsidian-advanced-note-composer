[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer#relative-links)

# Relative links

When you extract or merge a note that contains links **relative to its folder**, the core
Note composer leaves them pointing at the wrong place. Advanced Note Composer rewrites them
so they keep resolving.

## Try it

1. Open [[Note with relative links]] in the `Relative links` folder.
2. Select its two bullet links.
3. Run `Extract current selection...` and extract them into a **new note at the vault root**.
4. Open the new note and confirm both links still resolve to the sibling and the deep note.

Without this plugin, the extracted links would break because they were written relative to
the `Relative links` folder, not the vault root.
