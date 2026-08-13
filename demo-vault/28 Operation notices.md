# Operation notices

Every operation this plugin runs tells you about itself: a notice **while it is running**, so you know
when not to touch Obsidian, and a notice **naming what it did** once it finished. Merging, splitting and
extracting, swapping, moving and flattening folders, renaming a heading and reordering headings all report
the same way.

The running notice only appears once an operation has been going for about half a second, so quick ones
never flash one up - and it is the notice that carries the operation's **Cancel** button.

## Try it

1. Run any operation from another note in this vault - `[[17 Flatten folder]]` and `[[07 Swap file]]` are
   quick ones.
2. Watch the bottom-right corner. When it finishes you get a notice like
   `Flattened folder Demo into /, promoting 3 item(s).` - the note and folder names in it are clickable.
3. Open `Settings -> Advanced Note Composer -> UI` and turn **Should show operation notices** off.
4. Run the same operation again. It does exactly the same thing, silently.
5. Turn the setting back on.

## Good to know

- Refusals and errors - "this path is ignored in the plugin settings" and the like - are **always** shown,
  whatever this setting says.
- With the setting off you also lose the `Cancel` button that lives on the running notice. A long operation
  can still be cancelled by right-clicking the note's lock indicator and unlocking it.
- Two related settings are separate on purpose: **Should show smart cut & paste notice** controls the
  *interactive* marked-selection notice (turning it off removes its buttons, not just information), and
  **Smart cut & paste completion feedback** already decides how a finished move announces itself - see
  `[[09 Smart cut and paste]]`.
