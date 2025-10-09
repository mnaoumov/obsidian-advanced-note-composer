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
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { PrismComponent } from './PrismComponent.ts';

export class Plugin extends PluginBase<PluginTypes> {
  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
  }

  protected override createSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();

    this.addChild(new PrismComponent());

    new MergeFileCommand(this).register();
    new ExtractCurrentSelectionEditorCommand(this).register();
    new ExtractThisHeadingEditorCommand(this).register();
    new ExtractBeforeCursorEditorCommand(this).register();
    new ExtractAfterCursorEditorCommand(this).register();

    // eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
    const HEADING_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];
    for (const headingLevel of HEADING_LEVELS) {
      new SplitNoteByHeadingsEditorCommand(this, headingLevel).register();
      new SplitNoteByHeadingsContentEditorCommand(this, headingLevel).register();
    }
  }
}
