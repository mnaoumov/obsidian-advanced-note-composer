[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Block commands on excluded paths

The **Include paths** / **Exclude paths** settings mark some notes and folders as ignored. By default,
Advanced Note Composer still shows its commands on an ignored path and only pops an "ignored in the
plugin settings" notice when you actually trigger one.

Turn on **Should block commands on excluded paths** to hide the commands entirely on ignored paths
instead: they disappear from the command palette and from the editor, file, and folder context menus,
so you cannot trigger them there at all.

## Try it

1. Open the plugin settings and, under **Include/exclude paths**, add a folder name (for example
   `Merge folder`) to **Exclude paths**.
2. Leave **Should block commands on excluded paths** off for now. Open a note inside that folder and
   right-click it: the Advanced Note Composer commands are still listed (and would show an "ignored"
   notice if run).
3. Now turn **Should block commands on excluded paths** on.
4. Right-click the same note again, or open the command palette on it: the Advanced Note Composer
   commands are gone.
5. Open a note that is not in the excluded folder and confirm the commands are still available there.

The setting is off by default, so nothing changes until you opt in.
