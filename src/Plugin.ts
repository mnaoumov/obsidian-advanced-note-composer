import type {
  App,
  PluginManifest
} from 'obsidian';
import type { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';
import type { ReadonlyDeep } from 'type-fest';

import { appendCodeBlock } from 'obsidian-dev-utils/html-element';
import { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import { alert } from 'obsidian-dev-utils/obsidian/modals/alert';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/plugin/components/plugin-settings-tab-component';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';

import type { Level } from './markdown-heading-document.ts';
import type { PluginSettings } from './plugin-settings.ts';

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

  public get pluginSettings(): ReadonlyDeep<PluginSettings> {
    return this.pluginSettingsComponent.settings;
  }

  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.pluginSettingsComponent = this.registerComponent({
      component: new PluginSettingsComponent({
        loadData: this.loadData.bind(this),
        saveData: this.saveData.bind(this)
      }),
      shouldPreload: true
    });
    this.registerComponent({
      component: new PluginSettingsTabComponent(
        this,
        new PluginSettingsTab({
          plugin: this,
          pluginSettingsComponent: this.pluginSettingsComponent
        }) as PluginSettingsTabBase<object>
      )
    });
  }

  public consoleDebug(message: string, ...args: unknown[]): void {
    this.consoleDebugComponent.debug(message, ...args);
  }

  protected override async onLayoutReady(): Promise<void> {
    await super.onLayoutReady();
    await this.showReleaseNotes();
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();

    this.addChild(new PrismComponent());

    this.addChild(new CommandHandlerComponent(this, new MergeFileCommandHandler(this)));
    this.addChild(new CommandHandlerComponent(this, new ExtractCurrentSelectionEditorCommandHandler(this)));
    this.addChild(new CommandHandlerComponent(this, new ExtractThisHeadingEditorCommandHandler(this)));
    this.addChild(new CommandHandlerComponent(this, new ExtractBeforeCursorEditorCommandHandler(this)));
    this.addChild(new CommandHandlerComponent(this, new ExtractAfterCursorEditorCommandHandler(this)));
    this.addChild(new CommandHandlerComponent(this, new MergeFolderCommandHandler(this)));
    this.addChild(new CommandHandlerComponent(this, new SwapFileCommandHandler(this)));
    this.addChild(new CommandHandlerComponent(this, new SwapFolderCommandHandler(this)));

    // eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
    const HEADING_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];
    for (const headingLevel of HEADING_LEVELS) {
      this.addChild(new CommandHandlerComponent(this, new SplitNoteByHeadingsEditorCommandHandler(this, headingLevel)));
      this.addChild(new CommandHandlerComponent(this, new SplitNoteByHeadingsContentEditorCommandHandler(this, headingLevel)));
    }
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
      if (this.pluginSettings.releaseNotesShown.includes(version)) {
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
