import type { App } from 'obsidian';
import type { ReleaseNotes } from 'obsidian-dev-utils/obsidian/components/release-notes-component';

import { ReleaseNotesComponent } from 'obsidian-dev-utils/obsidian/components/release-notes-component';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

interface CreateReleaseNotesComponentParams {
  readonly app: App;
  readonly pluginName: string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

// The popup itself is obsidian-dev-utils' `ReleaseNotesComponent`: it names the plugin in its title (issue #286),
// waits for `data.json` to be read before deciding what was already shown (issue #293), and shows the notes in
// version order. What stays here is this plugin's storage, its core-plugin gate, and the notes themselves.
export function createReleaseNotesComponent(params: CreateReleaseNotesComponentParams): ReleaseNotesComponent {
  const { app, pluginName, pluginSettingsComponent } = params;

  return new ReleaseNotesComponent({
    app,
    getShownReleaseNoteVersions: (): readonly string[] => pluginSettingsComponent.settings.releaseNotesShown,
    pluginName,
    pluginSettingsComponent,
    releaseNotesProvider: buildReleaseNotes,
    setShownReleaseNoteVersions: async (versions): Promise<void> => {
      await pluginSettingsComponent.editAndSave((settings) => {
        settings.releaseNotesShown = [...versions];
      });
    },
    // Only show the release notes when the enhanced built-in `Note composer` core plugin is enabled (issue #95).
    // When it is disabled, nothing is shown and no version is persisted.
    // This makes the notes appear the first time the user later enables the core plugin.
    shouldShowReleaseNotes: (): boolean => !!app.internalPlugins.getEnabledPluginById('note-composer')
  });
}

function buildReleaseNotes(): ReleaseNotes {
  return {
    '3.0.0': createFragment((f) => {
      f.appendText('The plugin no longer requires ');
      appendCodeBlock(f, 'Note composer');
      f.appendText(' core plugin. You can safely switch it off to avoid duplicated functionality.');
    }),
    // Issue #271 moved settings a user may have configured, so it is announced rather than left to be
    // discovered as "my exclusions disappeared" — the entries did move, but not to a page of that name.
    '5.11.0': createFragment((f) => {
      f.appendText('The ');
      appendCodeBlock(f, 'Include/exclude');
      f.appendText(' settings page is gone. Every include/exclude box now lives on the settings page of the commands it governs — ');
      appendCodeBlock(f, 'Merge');
      f.appendText(', ');
      appendCodeBlock(f, 'Split/extract');
      f.appendText(', and so on, with new ');
      appendCodeBlock(f, 'Select');
      f.appendText(' and ');
      appendCodeBlock(f, 'Rename');
      f.appendText(' pages for the two that had none.');
      f.createEl('br');
      f.appendText('The four boxes that covered every command at once have been retired. Whatever you had listed in them was copied into every command\'s own boxes, so nothing changes until you edit them.');
      f.createEl('br');
      // Issue #272 moves no setting VALUE, but it does remove an entry the user navigates by, which is
      // the same thing to anyone looking for a row where they last saw it.
      f.appendText('The ');
      appendCodeBlock(f, 'Title');
      f.appendText(' settings page has been merged into ');
      appendCodeBlock(f, 'Frontmatter');
      f.appendText(', where its rows now sit under a ');
      appendCodeBlock(f, 'Title');
      f.appendText(' heading together with the three that write the frontmatter ');
      appendCodeBlock(f, 'title');
      f.appendText('. Every setting keeps its value.');
    }),
    // Issue #288 changes what a setting the user already configured DOES, which is exactly what goes
    // unnoticed until a command that used to refuse quietly runs.
    '5.12.0': createFragment((f) => {
      f.appendText('The ');
      appendCodeBlock(f, '<Category> exclude paths');
      f.appendText(' and ');
      appendCodeBlock(f, '<Category> include paths');
      f.appendText(' boxes no longer stop a command you run ON a listed note or folder. They keep it out of the pickers, refuse it as a target, and keep it from being swept up by a folder operation, as before.');
      f.createEl('br');
      f.appendText('If you relied on the refusal, list the same path in that category\'s ');
      appendCodeBlock(f, '<Category> command exclude paths');
      f.appendText(', which hides the commands there instead.');
      f.createEl('br');
      f.appendText('The two ');
      appendCodeBlock(f, 'Rename');
      f.appendText(' boxes of that kind did nothing but refuse, so they are gone. What you had listed in them was moved into the ');
      appendCodeBlock(f, 'Rename command');
      f.appendText(' boxes, so renaming stays blocked where it was.');
      f.createEl('br');
      // Issue #275: a heading the user navigates by disappeared, and a row moved to another page.
      f.appendText('The ');
      appendCodeBlock(f, 'Merge/split/extract strategies');
      f.appendText(' settings heading is gone: its rows are now in ');
      appendCodeBlock(f, 'Common');
      f.appendText(', with every other setting several commands read. ');
      appendCodeBlock(f, 'Should show console debug messages');
      f.appendText(' moved to the ');
      appendCodeBlock(f, 'UI');
      f.appendText(' page. Every setting keeps its value.');
      f.createEl('br');
      // Issue #278: a top-level page the user navigates by disappeared.
      f.appendText('The ');
      appendCodeBlock(f, 'Command menu placement');
      f.appendText(' settings page is gone: each ');
      appendCodeBlock(f, '<Category> command menus');
      f.appendText(' section moved to the page of its own commands, next to its include/exclude paths. Every setting keeps its value.');
    })
  };
}
