# Note with relative links

This note contains links that are **relative to this folder**:

- A sibling note: [Sibling note](<Sibling note.md>)
- A note in a subfolder: [Deep note](<Subfolder/Deep note.md>)

When you extract a selection from this note (or merge it) into a note in a **different**
folder, the core Note composer would leave these links pointing at the wrong place.
Advanced Note Composer rewrites them so they keep resolving to the same targets.

Select the two bullet points above and try `Extract current selection...` into a note
at the vault root, then check that the links still work.
