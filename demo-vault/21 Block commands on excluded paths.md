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
