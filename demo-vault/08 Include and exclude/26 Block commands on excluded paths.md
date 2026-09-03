# Block commands on excluded paths

Advanced Note Composer has **two independent path filters**, and knowing which is which is the whole trick:

- **`<Category>` include paths** / **`<Category>` exclude paths** decide what those commands will *touch*. An excluded note never shows up in a merge/split picker, is refused as a target or a source, and is never moved by a folder merge or a flatten. The commands are still listed, and only pop an "ignored in the plugin settings" notice when you trigger one.
- **`<Category>` command include paths** / **`<Category>` command exclude paths** decide where those commands are *offered* at all. A path listed here loses them entirely — from the command palette and from the editor, file, and folder context menus.

So you can hide the merge commands in a folder you still merge into, or keep them handy in a folder that must never be merged. Every box is empty by default, so nothing is excluded and nothing is hidden.

Both filters are **per command category**, and there is no longer any box that covers every command at once. Each category's boxes live on the settings page of the commands they govern: **Merge**, **Split/extract**, **Select**, **Swap**, **Smart cut & paste**, **Move/flatten folders**, **Create**, **Rename** and **Reorder**. Seven of those pages hold other settings too, so their boxes sit under an **`<Category>` include/exclude paths** heading at the bottom; **Rename** and **Select** hold nothing else, so their boxes are the whole page.

## Path forms

Each line of any box is either a path string or a `/regular expression/`, and they match differently:

- A **path string** matches that note or folder **and everything inside it**. `Merge folder` covers `Merge folder` itself and every note under it.
- A **`/regular expression/`** is tested against the path exactly as written. That is how you match a folder *without* its contents: `/^Merge folder$/` matches only the folder itself.

If a line is not a valid regular expression, the setting says `Invalid regular expression: …` and the **whole list** is ignored until you fix it — so one broken entry disables the others in that box.

## Try it

1. Open the plugin settings, go to **Merge**, and scroll to **Merge include/exclude paths**. Add a folder path (for example `Materials/02 Merge folder/Merge folder`) to **Merge exclude paths**.
2. Open a note inside that folder and right-click it: the merge commands are still listed. Run one and it refuses with an "ignored" notice — excluded from merges, but not hidden.
3. Now add the same folder path to **Merge command exclude paths**, in the same group.
4. Right-click the same note again, or open the command palette on it: the merge commands are gone, while every other Advanced Note Composer command is still there.
5. Open a note that is not in that folder and confirm the merge commands are still available there.
6. Change the **Merge command exclude paths** entry to the regular expression `/Merge folder$/`. Right-click a note inside the folder: the commands are back, because a path ending in `Merge folder` is the folder itself and nothing under it. Right-click the `Merge folder` folder: its merge commands are still hidden.
7. Clear **Merge command exclude paths** and put the folder path in **Merge command include paths** instead. Now it is the other way round: the merge commands are offered *only* inside that folder and hidden everywhere else.

Clear all four boxes when you are done to put the vault back to its default state.

## Blocking only some commands

Every command belongs to exactly one category, and each category's command boxes cover it and nothing else:

- **Merge** — the four merges.
- **Split/extract** — every extract, and every split by headings.
- **Select** — the five `Select ...` commands and the three `Selection anchor` commands.
- **Create** — the two create-empty-note commands and `Create folder with notes...`.
- **Smart cut & paste** — marking a selection or heading to move, and the three moves that paste it.
- **Swap** — the file and folder swaps, and the two selection swaps.
- **Move/flatten folders** — `Move folder...` and the three flatten commands.
- **Rename** — `Rename folder...` and `Rename heading`.
- **Reorder** — the three reorder commands.

Each box says which commands it covers, right under its name, so you never have to guess which category a command is in.

That is enough for the three things people usually want:

- **Block one kind of command here.** Put the folder path in `Merge -> Merge command exclude paths`. Merges are gone in that folder; splitting, renaming and reordering still work.
- **Block everything except one kind.** Put the folder path in the exclude box of every category *except* the one you keep — eight boxes, one line each, spread over eight pages. The kept category is the one you did not list.
- **Allow one kind only here.** Put the folder path in `Merge -> Merge command include paths`. The merge commands are then offered inside that folder and nowhere else, while every other category is untouched.

### Try it

1. Open the plugin settings, go to **Smart cut & paste**, and scroll to **Smart cut & paste include/exclude paths**.
2. Put `Materials/02 Merge folder/Merge folder` in **Smart cut & paste command exclude paths**.
3. Select some text in a note inside that folder and right-click it: `Mark selection to move` is gone, while `Extract current selection...` and the merge commands are still there.
4. Do the same in a note outside that folder to confirm the command is untouched everywhere else.
5. To take the rest away as well, list the same path in the other categories' command exclude boxes. There is no single box that does it for you — that is deliberate, so a path is only ever listed under the commands it affects.
6. Clear the boxes when you are done.

## Excluding paths from only some commands

The section above hides commands. This one is the same idea applied to the **other** filter: what a command may *touch*.

- **Keep a folder out of one command's dialogs.** Put the folder path in `Reorder -> Reorder exclude paths`. The reorder modal stops listing it, while merges, splits and renames go on using it exactly as before.
- **Let one command work only in one place.** Put the folder path in `Merge -> Merge include paths`. The merge commands then touch nothing outside that folder, and no other command notices.

The **Reorder include/exclude paths** group holds four boxes, and the two halves answer different questions — worth keeping straight:

| Box | Effect on a listed path |
| --- | --- |
| `Reorder exclude paths` | The reorder commands are still offered, and still run — they just skip that path. It is absent from the modal. |
| `Reorder command exclude paths` | The reorder commands are gone there entirely: not in the command palette, not in the context menus. |

Within one category the exclude box wins over the include box, so listing a path in both is not an exception that brings it back.

`Select` is the one category with no content pair, and only two boxes on its page. The `Select ...` commands move the caret and write nothing, so there is no content for a filter to allow or refuse — a pair there would be two boxes read by nothing. Hiding those commands on a path is what **Select command exclude paths** is for.

### Try it

1. Right-click `Materials/23 Reorder folders/Reorder example` and run `Reorder child folders`. All three of `1. Alpha`, `2. Beta` and `3. Gamma` are listed — see [23 Reorder folders](<../06 Folder operations/23 Reorder folders.md>).
2. Open the plugin settings, go to **Reorder**, scroll to **Reorder include/exclude paths**, and put `Materials/23 Reorder folders/Reorder example/2. Beta` in **Reorder exclude paths**.
3. Run `Reorder child folders` on `Reorder example` again: `2. Beta` is gone from the list, and only `1. Alpha` and `3. Gamma` can be moved.
4. Right-click `2. Beta` itself: every Advanced Note Composer command is still there, and `Merge current folder with another folder...` still offers it as a destination. Only the reorder skipped it.
5. Clear that box, and put the same path in **Reorder command exclude paths** instead. Now right-click `2. Beta`: the reorder commands are gone from its menu — while `Reorder child folders` on the parent still lists it, because hiding a command is not the same as excluding a path. That is the pair, both ways round.
6. Clear both boxes when you are done.

## An excluded path is never moved

Exclusion is not only about pickers: an excluded item is never **moved** either. A flatten leaves it exactly where it is, contents included, and hides its command entirely when that leaves nothing to move — see [20 Flatten folder](<../06 Folder operations/20 Flatten folder.md>).

That is the reliable way to protect your attachment folder from a flatten in a vault where a plugin such as [Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location) decides where attachments go. Such a plugin derives each folder from the note — possibly from its name, its properties, the date, or a prompt — so there is no working backwards from a folder to "this is an attachment folder", and your vault's own `Default location for new attachments` is not a usable substitute there. Excluding the folder says it directly. Without such a plugin, that setting is recognized on its own. To protect it from every command, list it in each category's exclude box; the ones that matter most are **Move/flatten folders** and **Merge**, which are the categories that move things.

Every merge skips an ignored note and reports it, unless **Should always merge excluded items** is on. That covers every merge command, the batch ones included — [`Merge folder contents into a single file...`](<../01 Merge/03 Merge folder into single file.md>) and [`Merge these files into one file...`](<../01 Merge/04 Merge multiple files.md>).

Whether an excluded note or folder can be the **destination** is a second, independent setting: **Should offer excluded paths as merge destinations**. With it off — the default — no merge picker ever lists an excluded path, so [`Merge current folder with another folder...`](<../01 Merge/02 Merge folder.md>) will not offer an excluded folder however the first setting is set. Turn it on and every merge picker offers them, [`Merge current file with another file...`](<../01 Merge/01 Merge file.md>) included, and the merge lands there.

The two are worth keeping apart because they answer different questions — what a merge picks up, and where it may put it. Neither decides where a merge is **offered**: a command hidden by **Merge command exclude paths** stays hidden either way.

## Upgrading

Two rounds of settings have led here, and both were carried over for you.

These filters used to be one list plus a **Should block commands on excluded paths** switch, which could not express "hide the commands here, but still let me merge into it". If you had that switch on, your entries were copied into the command boxes when you upgraded.

There were then four boxes that covered **every** command at once, sitting above the per-category ones on a settings page of their own called **Include/exclude**. Having both invited the confusing case where a path was listed in the all-commands box *and* in a category's box, with neither one explaining the result on its own — so the all-commands boxes are gone, and the page with them. Whatever you had listed in them was copied into every category's boxes when you upgraded, so nothing changed for you; if you want a path back for one category, clear it from that category's box.
