[Docs](https://github.com/mnaoumov/obsidian-codescript-toolkit/)

# CodeScript Toolkit prerequisite

Some notes in this vault contain **Run** buttons (rendered from ```` ```code-button ```` blocks) that flip an Advanced Note Composer setting and reload the app for you. Those buttons are a feature of the separate [`CodeScript Toolkit`](https://github.com/mnaoumov/obsidian-codescript-toolkit/) plugin.

## It installs itself

You normally do **not** need to do anything. This vault ships a tiny bundled `Demo Vault Helper` plugin that, the first time you open the vault (right after you trust it), automatically installs and enables `CodeScript Toolkit`, then opens [[00 Start]]. It also points `CodeScript Toolkit`'s modules root at `_assets/CodeScriptToolkit`, so the **Run** buttons work immediately afterwards.

If you ever want to check, open [[17 Code buttons check]] and click the button - a notice means everything is ready.

## Manual fallback

If the auto-install cannot run (you are offline, or you declined the community-plugins prompt), you can do it by hand:

1. Open **Settings → Community plugins**.
2. Click **Browse**, search for `CodeScript Toolkit`, and click **Install**, then **Enable**.
3. Reload Obsidian (or run the **Reload app without saving** command).

And even without `CodeScript Toolkit` at all, every button in this vault is accompanied by the equivalent manual steps (change the setting in **Settings → Advanced Note Composer**), so the vault is fully usable regardless.
