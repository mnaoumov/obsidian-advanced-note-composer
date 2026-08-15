# Block commands on excluded paths

Advanced Note Composer has **two independent path filters**, and knowing which is which is the whole
trick:

- **Include paths** / **Exclude paths** decide what the plugin will *touch*. An excluded note never shows
  up in a merge/split picker, is refused as a target or a source, and is never moved by a folder merge or
  a flatten. Its commands are still listed, and only pop an "ignored in the plugin settings" notice when
  you trigger one.
- **Command include paths** / **Command exclude paths** decide where the commands are *offered* at all. A
  path listed here loses them entirely — from the command palette and from the editor, file, and folder
  context menus.

So you can hide the commands in a folder you still merge into, or keep them handy in a folder that must
never be merged. All four boxes are empty by default, so nothing is excluded and nothing is hidden.

## Path forms

Each line of any of the four boxes is either a path string or a `/regular expression/`, and they match
differently:

- A **path string** matches that note or folder **and everything inside it**. `Merge folder` covers
  `Merge folder` itself and every note under it.
- A **`/regular expression/`** is tested against the path exactly as written. That is how you match a
  folder *without* its contents: `/^Merge folder$/` matches only the folder itself.

If a line is not a valid regular expression, the setting says `Invalid regular expression: …` and the
**whole list** is ignored until you fix it — so one broken entry disables the others in that box.

## Try it

1. Open the plugin settings and, under **Include/exclude paths**, add a folder name (for example
   `Merge folder`) to **Exclude paths**.
2. Open a note inside that folder and right-click it: the Advanced Note Composer commands are still
   listed. Run one and it refuses with an "ignored" notice — excluded from merges, but not hidden.
3. Now, under **Command include/exclude paths**, add the same folder name to **Command exclude paths**.
4. Right-click the same note again, or open the command palette on it: the Advanced Note Composer
   commands are gone.
5. Open a note that is not in that folder and confirm the commands are still available there.
6. Change the **Command exclude paths** entry from `Merge folder` to `/^Merge folder$/`. Right-click a
   note inside the folder: the commands are back, because the regex matches only the folder path itself.
   Right-click the `Merge folder` folder: its commands are still hidden.
7. Clear **Command exclude paths** and put `Merge folder` in **Command include paths** instead. Now it is
   the other way round: the commands are offered *only* inside that folder and hidden everywhere else.

Clear all four boxes when you are done to put the vault back to its default state.

## An excluded path is never moved

Exclusion is not only about pickers: an excluded item is never **moved** either. A flatten leaves it
exactly where it is, contents included, and hides its command entirely when that leaves nothing to
move — see [20 Flatten folder](<../06 Folder operations/20 Flatten folder.md>).

That is the reliable way to protect your attachment folder from a flatten in a vault where a plugin
such as [Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location)
decides where attachments go. Such a plugin derives each folder from the note — possibly from its
name, its properties, the date, or a prompt — so there is no working backwards from a folder to "this
is an attachment folder", and your vault's own `Default location for new attachments` is not a usable
substitute there. Excluding the folder says it directly. Without such a plugin, that setting is
recognized on its own.

Every merge skips an ignored note and reports it, unless **Should always merge excluded items** is on.
That covers the batch commands — [`Merge folder contents into a single file...`](<../01 Merge/03 Merge folder into single file.md>)
and [`Merge these files into one file...`](<../01 Merge/04 Merge multiple files.md>) — and, since the setting
was made to mean what it says, [`Merge current file with another file...`](<../01 Merge/01 Merge file.md>) too:
with it on, an excluded note is offered in the destination picker and can be merged into.

The setting decides what a merge may swallow, not where a merge is offered. A command hidden by
**Command exclude paths** stays hidden either way.

## Upgrading from the old single toggle

These used to be one list plus a **Should block commands on excluded paths** switch, which could not
express "hide the commands here, but still let me merge into it". If you had that switch on, your
`Include paths` and `Exclude paths` entries were copied into the two command boxes when you upgraded,
so nothing changed for you.
