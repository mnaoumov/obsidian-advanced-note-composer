import type { App } from 'obsidian';

import { appendCodeBlock } from 'obsidian-dev-utils/html-element';
import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
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
    const RELEASE_NOTES: Record<string, DocumentFragment> = {
      '3.0.0': createFragment((f) => {
        f.appendText('The plugin no longer requires ');
        appendCodeBlock(f, 'Note composer');
        f.appendText(' core plugin. You can safely switch it off to avoid duplicated functionality.');
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
