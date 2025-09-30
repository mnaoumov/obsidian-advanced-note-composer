import type { Menu } from 'obsidian';

import { MenuItem } from 'obsidian';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';

import type { Level } from './MarkdownHeadingDocument.ts';
import type { PluginTypes } from './PluginTypes.ts';

import { ExtractAfterCursorEditorCommand } from './Commands/ExtractAfterCursorEditorCommand.ts';
import { ExtractBeforeCursorEditorCommand } from './Commands/ExtractBeforeCursorEditorCommand.ts';
import { ExtractCurrentSelectionEditorCommand } from './Commands/ExtractCurrentSelectionEditorCommand.ts';
import { ExtractThisHeadingEditorCommand } from './Commands/ExtractThisHeadingEditorCommand.ts';
import { MergeFileCommand } from './Commands/MergeFileCommand.ts';
import { SplitNoteByHeadingsContentEditorCommand } from './Commands/SplitNoteByHeadingsContentEditorCommand.ts';
import { SplitNoteByHeadingsEditorCommand } from './Commands/SplitNoteByHeadingsEditorCommand.ts';
import { CorePluginWrapper } from './CorePluginWrapper.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

export class Plugin extends PluginBase<PluginTypes> {
  private corePluginWrapper!: CorePluginWrapper;

  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
  }

  protected override createSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();

    this.corePluginWrapper = new CorePluginWrapper(this.app);
    new MergeFileCommand(this, this.corePluginWrapper).register();
    new ExtractCurrentSelectionEditorCommand(this, this.corePluginWrapper).register();
    new ExtractThisHeadingEditorCommand(this, this.corePluginWrapper).register();
    new ExtractBeforeCursorEditorCommand(this, this.corePluginWrapper).register();
    new ExtractAfterCursorEditorCommand(this, this.corePluginWrapper).register();

    // eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
    const HEADING_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];
    for (const headingLevel of HEADING_LEVELS) {
      new SplitNoteByHeadingsEditorCommand(this, this.corePluginWrapper, headingLevel).register();
      new SplitNoteByHeadingsContentEditorCommand(this, this.corePluginWrapper, headingLevel).register();
    }
    this.registerEvent(this.app.workspace.on('file-menu', this.handleFileMenu.bind(this)));
    this.registerEvent(this.app.workspace.on('editor-menu', this.handleEditorMenu.bind(this)));
  }

  private handleEditorMenu(menu: Menu): void {
    if (this.settings.shouldHideCorePluginMenuItems) {
      filterMenuItems(menu, [
        'plugins.note-composer.command-split-file',
        'plugins.note-composer.command-extract-heading'
      ]);
    }
  }

  private handleFileMenu(menu: Menu): void {
    if (this.settings.shouldHideCorePluginMenuItems) {
      filterMenuItems(menu, [
        'plugins.note-composer.action-merge-file'
      ]);
    }
  }
}

function filterMenuItems(menu: Menu, localizationKeysToSkip: string[]): void {
  menu.items = menu.items.filter((item) => {
    if (!(item instanceof MenuItem)) {
      return true;
    }

    const menuItemTexts = localizationKeysToSkip.map((key) => window.i18next.t(key));
    return !menuItemTexts.includes(item.titleEl.textContent);
  });
}
