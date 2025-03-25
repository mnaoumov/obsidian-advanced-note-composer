import { PluginSettingTab, type Editor, type MarkdownFileInfo, type MarkdownView } from 'obsidian';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';

import { AdvancedNoteComposerPluginSettings } from './AdvancedNoteComposerPluginSettings.ts';
import { AdvancedNoteComposerPluginSettingsTab } from './AdvancedNoteComposerPluginSettingsTab.ts';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/FileSystem';
import { MergeFileModal } from './Modals/MergeFileModal.ts';
import { InternalPluginName } from 'obsidian-typings/implementations';

export class AdvancedNoteComposerPlugin extends PluginBase<AdvancedNoteComposerPluginSettings> {
  protected override createPluginSettings(data: unknown): AdvancedNoteComposerPluginSettings {
    return new AdvancedNoteComposerPluginSettings(data);
  }

  protected override createPluginSettingsTab(): null | PluginSettingTab {
    return new AdvancedNoteComposerPluginSettingsTab(this);
  }

  private mergeFile(checking: boolean): boolean {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return false;
    }

    if (!isMarkdownFile(this.app, file)) {
      return false;
    }

    if (!checking) {
      if (this.checkCorePluginEnabled()) {
        new MergeFileModal(this.app).open();
      }
    }

    return true;
  }

  private checkCorePluginEnabled(): boolean {
    const noteComposerPlugin = this.app.internalPlugins.getPluginById(InternalPluginName.NoteComposer);
    if (!noteComposerPlugin) {
      return false;
    }

    const ans = noteComposerPlugin.enabled;
    if (!ans) {
      new Notice('Note composer Core plugin is not enabled');
    }

    return ans;
  }

  private splitFile(checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo): boolean {
    if (!ctx.file) {
      return false;
    }

    if (!editor.somethingSelected()) {
      return false;
    }

    if (!checking) {
      if (this.checkCorePluginEnabled()) {
        new Notice('Split file');
      }
    }

    return true;
  }

  private extractHeading(checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo): boolean {
    if (!ctx.file) {
      return false;
    }

    const lineNumber = editor.getCursor().line;
    const line = editor.getLine(lineNumber)
    const heading = extractHeading(line)
    if (!heading) {
      return false;
    }

    if (!checking) {
      if (this.checkCorePluginEnabled()) {
        new Notice('Extract heading');
      }
    }

    return true;
  }

  protected override onloadComplete(): void {
    const noteComposerPlugin = this.app.internalPlugins.getPluginById(InternalPluginName.NoteComposer);
    if (!noteComposerPlugin) {
      return;
    }

    this.addCommand({
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge file',
      checkCallback: this.mergeFile.bind(this)
    });

    this.addCommand({
      icon: 'lucide-scissors',
      id: 'split-file',
      name: 'Split file',
      editorCheckCallback: this.splitFile.bind(this)
    });

    this.addCommand({
      icon: 'lucide-scissors',
      id: 'extract-heading',
      name: 'Extract heading',
      editorCheckCallback: this.extractHeading.bind(this)
    });
  }
}

function extractHeading(line: string): string | null {
  const match = line.match(/^#{1,6} (.*)/m);
  return match?.[1] ?? null;
}