import { AppActiveFileProvider } from 'obsidian-dev-utils/obsidian/active-file-provider';
import { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import { PluginCommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import { MenuEventRegistrarComponent } from 'obsidian-dev-utils/obsidian/components/menu-event-registrar-component';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
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
import { ReleaseNotesComponent } from './release-notes-component.ts';

export class Plugin extends PluginBase {
  protected override onloadImpl(): void {
    const pluginSettingsComponent = this.addChild(
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
          pluginSettingsComponent
        })
      })
    );

    // eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
    const HEADING_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];
    const menuEventRegistrar = this.addChild(new MenuEventRegistrarComponent(this.app));
    this.addChild(
      new CommandHandlerComponent({
        activeFileProvider: new AppActiveFileProvider(this.app),
        commandHandlers: [
          new MergeFileCommandHandler({
            app: this.app,
            consoleDebugComponent: this.consoleDebugComponent,
            pluginSettingsComponent
          }),
          new ExtractCurrentSelectionEditorCommandHandler({
            app: this.app,
            consoleDebugComponent: this.consoleDebugComponent,
            pluginSettingsComponent
          }),
          new ExtractThisHeadingEditorCommandHandler({
            app: this.app,
            consoleDebugComponent: this.consoleDebugComponent,
            pluginSettingsComponent
          }),
          new ExtractBeforeCursorEditorCommandHandler({
            app: this.app,
            consoleDebugComponent: this.consoleDebugComponent,
            pluginSettingsComponent
          }),
          new ExtractAfterCursorEditorCommandHandler({
            app: this.app,
            consoleDebugComponent: this.consoleDebugComponent,
            pluginSettingsComponent
          }),
          new MergeFolderCommandHandler({
            app: this.app,
            consoleDebugComponent: this.consoleDebugComponent,
            pluginSettingsComponent
          }),
          new SwapFileCommandHandler({
            app: this.app,
            pluginSettingsComponent
          }),
          new SwapFolderCommandHandler({
            app: this.app,
            pluginSettingsComponent
          }),
          ...HEADING_LEVELS.flatMap((headingLevel) => [
            new SplitNoteByHeadingsEditorCommandHandler({
              app: this.app,
              consoleDebugComponent: this.consoleDebugComponent,
              headingLevel,
              pluginSettingsComponent
            }),
            new SplitNoteByHeadingsContentEditorCommandHandler({
              app: this.app,
              consoleDebugComponent: this.consoleDebugComponent,
              headingLevel,
              pluginSettingsComponent
            })
          ])
        ],
        commandRegistrar: new PluginCommandRegistrar(this),
        menuEventRegistrar,
        pluginName: this.manifest.name
      })
    );

    this.addChild(new PrismComponent());
    this.addChild(
      new ReleaseNotesComponent({
        app: this.app,
        pluginSettingsComponent
      })
    );
  }
}
