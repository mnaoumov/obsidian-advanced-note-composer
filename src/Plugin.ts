import type {
  EditorPosition,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  TAbstractFile
} from 'obsidian';
import type { NoteComposerPlugin } from 'obsidian-typings';

import {
  Editor,
  Notice,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/FileSystem';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';
import { InternalPluginName } from 'obsidian-typings/implementations';

import type { PluginTypes } from './PluginTypes.ts';

import { MergeFileSuggestModal } from './MergeFileModal.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import {
  extractHeadingFromLine,
  SplitFileSuggestModal
} from './SplitFileModal.ts';

export class Plugin extends PluginBase<PluginTypes> {
  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
  }

  protected override createSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();

    this.addCommand({
      checkCallback: this.checkOrExecMergeFileCommand.bind(this),
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge current file with another file...'
    });

    this.addCommand({
      editorCheckCallback: this.checkOrExecSplitFileCommand.bind(this),
      icon: 'lucide-scissors',
      id: 'split-file',
      name: 'Extract current selection...'
    });

    this.addCommand({
      editorCheckCallback: this.checkOrExecExtractHeadingCommand.bind(this),
      icon: 'lucide-scissors',
      id: 'extract-heading',
      name: 'Extract this heading...'
    });

    // eslint-disable-next-line no-magic-numbers
    const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];
    for (const headingLevel of HEADING_LEVELS) {
      this.addCommand({
        editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownFileInfo | MarkdownView): boolean =>
          this.checkOrExecSplitNoteByHeadingsCommand(checking, editor, ctx, headingLevel, false),
        icon: 'lucide-scissors-line-dashed',
        id: `split-note-by-headings-h${String(headingLevel)}`,
        name: `Split note by headings - H${String(headingLevel)}`
      });

      this.addCommand({
        editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownFileInfo | MarkdownView): boolean =>
          this.checkOrExecSplitNoteByHeadingsCommand(checking, editor, ctx, headingLevel, true),
        icon: 'lucide-scissors-line-dashed',
        id: `split-note-by-headings-content-h${String(headingLevel)}`,
        name: `Split note by headings content - H${String(headingLevel)}`
      });
    }
    this.registerEvent(this.app.workspace.on('file-menu', this.handleFileMenu.bind(this)));
    this.registerEvent(this.app.workspace.on('editor-menu', this.handleEditorMenu.bind(this)));
  }

  private checkOrExecExtractHeadingCommand(checking: boolean, editor: Editor, ctx: MarkdownFileInfo | MarkdownView): boolean {
    const sourceFile = ctx.file;
    if (!sourceFile) {
      return false;
    }

    const lineNumber = editor.getCursor().line;
    const line = editor.getLine(lineNumber);
    const heading = extractHeadingFromLine(line);
    if (!heading) {
      return false;
    }

    if (!checking) {
      invokeAsyncSafely(() => this.extractHeading(sourceFile, editor, false));
    }

    return true;
  }

  private checkOrExecMergeFileCommand(checking: boolean): boolean {
    const sourceFile = this.app.workspace.getActiveFile();
    if (!sourceFile) {
      return false;
    }

    if (!isMarkdownFile(this.app, sourceFile)) {
      return false;
    }

    if (!checking) {
      this.mergeFile(sourceFile);
    }

    return true;
  }

  private checkOrExecSplitFileCommand(checking: boolean, editor: Editor, ctx: MarkdownFileInfo | MarkdownView): boolean {
    const sourceFile = ctx.file;
    if (!sourceFile) {
      return false;
    }

    if (!editor.somethingSelected()) {
      return false;
    }

    if (!checking && this.getAndCheckCorePlugin()) {
      invokeAsyncSafely(() => this.splitFile(sourceFile, editor));
    }

    return true;
  }

  private checkOrExecSplitNoteByHeadingsCommand(
    checking: boolean,
    editor: Editor,
    ctx: MarkdownFileInfo | MarkdownView,
    headingLevel: number,
    shouldSplitContentOnly: boolean
  ): boolean {
    const file = ctx.file;
    if (!file) {
      return false;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return false;
    }

    const headings = cache.headings?.filter((heading) => heading.level === headingLevel);
    if (!headings || headings.length === 0) {
      return false;
    }

    if (!checking) {
      invokeAsyncSafely(() => this.splitNoteByHeadings(file, editor, headingLevel, shouldSplitContentOnly));
    }

    return true;
  }

  private async extractHeading(sourceFile: TFile, editor: Editor, shouldSplitContentOnly: boolean, shouldShowModal = true): Promise<void> {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    const lineNumber = editor.getCursor().line;
    const headingInfo = corePlugin.instance.getSelectionUnderHeading(sourceFile, editor, lineNumber);

    if (!headingInfo) {
      new Notice('Failed to find heading');
      return;
    }

    const splitStart: EditorPosition = shouldSplitContentOnly ? { ch: 1, line: headingInfo.start.line + 1 } : headingInfo.start;
    editor.setSelection(splitStart, headingInfo.end);
    await this.splitFile(sourceFile, editor, headingInfo.heading, shouldShowModal);
  }

  private getAndCheckCorePlugin(): NoteComposerPlugin | null {
    const corePlugin = this.getCorePlugin();
    if (!corePlugin.enabled) {
      new Notice('Note composer Core plugin is not enabled');
      return null;
    }
    return corePlugin;
  }

  private getCorePlugin(): NoteComposerPlugin {
    const noteComposerPlugin = this.app.internalPlugins.getPluginById(InternalPluginName.NoteComposer);
    if (!noteComposerPlugin) {
      throw new Error('Note composer Core plugin not found');
    }
    return noteComposerPlugin;
  }

  private handleEditorMenu(menu: Menu, editor: Editor, info: MarkdownFileInfo | MarkdownView): void {
    const sourceFile = info.file;

    if (!sourceFile) {
      return;
    }

    if (editor.getSelection().trim()) {
      menu.addItem((item) => {
        return item
          .setTitle('Advanced extract current selection...')
          .setIcon('lucide-git-branch-plus')
          .setSection('selection')
          .onClick(() => {
            invokeAsyncSafely(() => this.splitFile(sourceFile, editor));
          });
      });
    }

    const lineNumber = editor.getCursor().line;
    const line = editor.getLine(lineNumber);
    const heading = extractHeadingFromLine(line);

    if (!heading) {
      return;
    }

    menu.addItem((item) => {
      return item
        .setTitle('Advanced extract this heading...')
        .setIcon('lucide-git-branch-plus')
        .onClick(() => {
          invokeAsyncSafely(() => this.extractHeading(sourceFile, editor, false));
        });
    });
  }

  private handleFileMenu(menu: Menu, file: TAbstractFile, source: string): void {
    if (source === 'link-context-menu') {
      return;
    }

    if (!(file instanceof TFile)) {
      return;
    }

    if (file.extension !== 'md') {
      return;
    }

    menu.addItem((item) => {
      item
        .setSection('action')
        .setTitle('Advanced merge entire file with...')
        .setIcon('lucide-git-merge')
        .onClick(() => {
          this.mergeFile(file);
        });
    });
  }

  private mergeFile(sourceFile: TFile): void {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    const modal = new MergeFileSuggestModal(this.app, corePlugin.instance, sourceFile);
    modal.open();
  }

  private async splitFile(sourceFile: TFile, editor: Editor, heading?: string, shouldShowModal = true): Promise<void> {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    const modal = new SplitFileSuggestModal(this, corePlugin.instance, sourceFile, editor, heading);
    if (shouldShowModal) {
      modal.open();
    } else {
      await modal.invokeWithoutUI();
    }
  }

  private async splitNoteByHeadings(sourceFile: TFile, editor: Editor, headingLevel: number, shouldSplitContentOnly: boolean): Promise<void> {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    let headingIndex = 0;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const cache = await getCacheSafe(this.app, sourceFile);
      if (!cache) {
        break;
      }

      const heading = (cache.headings ?? []).filter((h) => h.level === headingLevel)[headingIndex];
      if (!heading) {
        break;
      }

      editor.setCursor(heading.position.start.line);
      await this.extractHeading(sourceFile, editor, shouldSplitContentOnly, false);

      if (shouldSplitContentOnly) {
        headingIndex++;
      }
    }
  }
}
