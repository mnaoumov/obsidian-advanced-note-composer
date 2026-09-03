import type { App } from 'obsidian';

import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { alert } from 'obsidian-dev-utils/obsidian/modals/alert';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

interface ReleaseNotesComponentConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class ReleaseNotesComponent extends LayoutReadyComponent {
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: ReleaseNotesComponentConstructorParams) {
    super(params.app);

    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override async onLayoutReady(): Promise<void> {
    // Only show the release notes when the enhanced built-in `Note composer` core plugin is enabled (issue #95).
    // When it is disabled, nothing is shown and no version is persisted.
    // This makes the notes appear the first time the user later enables the core plugin.
    if (!this.app.internalPlugins.getEnabledPluginById('note-composer')) {
      return;
    }

    const RELEASE_NOTES: Record<string, DocumentFragment> = {
      '3.0.0': createFragment((f) => {
        f.appendText('The plugin no longer requires ');
        appendCodeBlock(f, 'Note composer');
        f.appendText(' core plugin. You can safely switch it off to avoid duplicated functionality.');
      }),
      // Issue #271 moved settings a user may have configured, so it is announced rather than left to be
      // Discovered as "my exclusions disappeared" — the entries did move, but not to a page of that name.
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
      })
    };

    const releaseNotes = createFragment();
    const notShownReleaseNoteVersions: string[] = [];

    for (const [version, versionReleaseNote] of Object.entries(RELEASE_NOTES)) {
      if (this.pluginSettingsComponent.settings.releaseNotesShown.includes(version)) {
        continue;
      }

      notShownReleaseNoteVersions.push(version);
      releaseNotes.createEl('h1', { text: version });
      releaseNotes.append(versionReleaseNote);
    }

    if (notShownReleaseNoteVersions.length === 0) {
      return;
    }

    await this.pluginSettingsComponent.editAndSave((settings) => {
      settings.releaseNotesShown = [...settings.releaseNotesShown, ...notShownReleaseNoteVersions];
    });

    await alert({
      app: this.app,
      message: releaseNotes,
      title: 'Release notes'
    });
  }
}
