import type {
  App,
  PluginManifest
} from 'obsidian';

import { appendCodeBlock } from 'obsidian-dev-utils/html-element';
import { AppActiveFileProvider } from 'obsidian-dev-utils/obsidian/active-file-provider';
import { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import { PluginCommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import { MenuEventRegistrarComponent } from 'obsidian-dev-utils/obsidian/components/menu-event-registrar-component';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { alert } from 'obsidian-dev-utils/obsidian/modals/alert';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import type { Level } from './markdown-heading-document.ts';

import { ExtractAfterCursorEditorCommandHandler } from './command-handlers/extract-after-cursor-editor-command-handler.ts';
import { ExtractBeforeCursorEditorCommandHandler } from './command-handlers/extract-before-cursor-editor-command-handler.ts';
import { ExtractCurrentSelectionEditorCommandHandler } from './command-handlers/extract-current-selection-editor-command-handler.ts';
import { ExtractThisHeadingEditorCommandHandler } from './command-handlers/extract-this-heading-editor-command-handler.ts';
import { MergeFileCommandHandler } from './command-handlers/merge-file-command-handler.ts';
import { MergeFolderCommandHandler } from './command-handlers/merge-folder-command-handler.ts';
import { SplitNoteByHeadingsContentEditorCommandHandler } from './command-handlers/split-note-by-headings-content-editor-command-handler.ts';
import { SplitNoteByHeadingsEditorCommandHandler } from './command-handlers/split-note-by-headings-editor-command-handler.ts';
import { SwapFileCommandHandler } from './command-handlers/swap-file-command-handler.ts';
import { SwapFolderCommandHandler } from './command-handlers/swap-folder-command-handler.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { PrismComponent } from './prism-component.ts';

export class Plugin extends PluginBase {
  public readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );

    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab: new PluginSettingsTab({
          plugin: this,
          pluginId: this.manifest.id,
          pluginSettingsComponent: this.pluginSettingsComponent
        })
      })
    );

    // eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
    const HEADING_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];
    const menuEventRegistrar = this.addChild(new MenuEventRegistrarComponent(app));
    this.addChild(
      new CommandHandlerComponent({
        activeFileProvider: new AppActiveFileProvider(app),
        commandHandlers: [
          new MergeFileCommandHandler(this),
          new ExtractCurrentSelectionEditorCommandHandler(this),
          new ExtractThisHeadingEditorCommandHandler(this),
          new ExtractBeforeCursorEditorCommandHandler(this),
          new ExtractAfterCursorEditorCommandHandler(this),
          new MergeFolderCommandHandler(this),
          new SwapFileCommandHandler(this),
          new SwapFolderCommandHandler(this),
          ...HEADING_LEVELS.flatMap((headingLevel) => [
            new SplitNoteByHeadingsEditorCommandHandler(this, headingLevel),
            new SplitNoteByHeadingsContentEditorCommandHandler(this, headingLevel)
          ])
        ],
        commandRegistrar: new PluginCommandRegistrar(this),
        menuEventRegistrar,
        pluginName: manifest.name
      })
    );

    this.addChild(new PrismComponent());
  }

  public consoleDebug(message: string, ...args: unknown[]): void {
    this.consoleDebugComponent.consoleDebug(message, ...args);
  }

  protected async onLayoutReady(): Promise<void> {
    await this.showReleaseNotes();
  }

  private async showReleaseNotes(): Promise<void> {
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
