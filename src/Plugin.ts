import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { alert } from 'obsidian-dev-utils/obsidian/Modals/Alert';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';

import type { Level } from './MarkdownHeadingDocument.ts';
import type { PluginTypes } from './PluginTypes.ts';

import { ExtractAfterCursorEditorCommand } from './Commands/ExtractAfterCursorEditorCommand.ts';
import { ExtractBeforeCursorEditorCommand } from './Commands/ExtractBeforeCursorEditorCommand.ts';
import { ExtractCurrentSelectionEditorCommand } from './Commands/ExtractCurrentSelectionEditorCommand.ts';
import { ExtractThisHeadingEditorCommand } from './Commands/ExtractThisHeadingEditorCommand.ts';
import { MergeFileCommand } from './Commands/MergeFileCommand.ts';
import { MergeFolderCommand } from './Commands/MergeFolderCommand.ts';
import { SplitNoteByHeadingsContentEditorCommand } from './Commands/SplitNoteByHeadingsContentEditorCommand.ts';
import { SplitNoteByHeadingsEditorCommand } from './Commands/SplitNoteByHeadingsEditorCommand.ts';
import { SwapFileCommand } from './Commands/SwapFileCommand.ts';
import { SwapFolderCommand } from './Commands/SwapFolderCommand.ts';
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

  protected override async onLayoutReady(): Promise<void> {
    await super.onLayoutReady();
    await this.showReleaseNotes();
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();

    this.addChild(new PrismComponent());

    new MergeFileCommand(this).register();
    new ExtractCurrentSelectionEditorCommand(this).register();
    new ExtractThisHeadingEditorCommand(this).register();
    new ExtractBeforeCursorEditorCommand(this).register();
    new ExtractAfterCursorEditorCommand(this).register();
    new MergeFolderCommand(this).register();
    new SwapFileCommand(this).register();
    new SwapFolderCommand(this).register();

    // eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
    const HEADING_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];
    for (const headingLevel of HEADING_LEVELS) {
      new SplitNoteByHeadingsEditorCommand(this, headingLevel).register();
      new SplitNoteByHeadingsContentEditorCommand(this, headingLevel).register();
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
      if (this.settings.releaseNotesShown.includes(version)) {
        continue;
      }

      notShownReleaseNoteVersions.push(version);
      releaseNotes.createEl('h1', { text: version });
      releaseNotes.append(versionReleaseNote);
    }

    if (notShownReleaseNoteVersions.length === 0) {
      return;
    }

    await this.settingsManager.editAndSave((settings) => {
      settings.releaseNotesShown = [...settings.releaseNotesShown, ...notShownReleaseNoteVersions];
    });

    await alert({
      app: this.app,
      message: releaseNotes,
      title: 'Release notes'
    });
  }
}
