import type {
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  TAbstractFile,
  Workspace
} from 'obsidian';
import type {
  NoteComposerPlugin,
  NoteComposerPluginInstance
} from 'obsidian-typings';

import {
  Editor,
  Modal,
  Notice,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import {
  getFile,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/FileSystem';
import {
  getCacheSafe,
  tempRegisterFileAndRun
} from 'obsidian-dev-utils/obsidian/MetadataCache';
import {
  invokeWithPatch,
  registerPatch
} from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';
import { InternalPluginName } from 'obsidian-typings/implementations';

import type { PluginTypes } from './PluginTypes.ts';
import type {
  MergeFileSuggestModalConstructor,
  SplitFileSuggestModalConstructor,
  SuggestItem,
  SuggestModalBase
} from './SuggestModal.ts';

import { DummyEditor } from './DummyEditor.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { extendSuggestModal } from './SuggestModal.ts';

type GetActiveFileFn = Workspace['getActiveFile'];

type OnEnableFn = NoteComposerPluginInstance['onEnable'];

type OpenFn = Modal['open'];

export class Plugin extends PluginBase<PluginTypes> {
  private isModalInitialized = false;
  private MergeFileSuggestModalConstructor!: MergeFileSuggestModalConstructor;
  private SplitFileSuggestModalConstructor!: SplitFileSuggestModalConstructor;

  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
  }

  protected override createSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();
    const corePlugin = this.getCorePlugin();

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
          this.checkOrExecSplitNoteByHeadingsCommand(checking, editor, ctx, headingLevel),
        icon: 'lucide-scissors-line-dashed',
        id: `split-note-by-headings-h${headingLevel.toString()}`,
        name: `Split note by headings - H${headingLevel.toString()}`
      });
    }
    this.registerEvent(this.app.workspace.on('file-menu', this.handleFileMenu.bind(this)));
    this.registerEvent(this.app.workspace.on('editor-menu', this.handleEditorMenu.bind(this)));

    registerPatch(this, corePlugin.instance, {
      onEnable: (next: OnEnableFn): OnEnableFn => {
        return async () => {
          await this.handleEnableCorePlugin(next);
        };
      }
    });

    if (corePlugin.enabled) {
      this.initModals();
    }
  }

  private checkOrExecExtractHeadingCommand(checking: boolean, editor: Editor, ctx: MarkdownFileInfo | MarkdownView): boolean {
    if (!ctx.file) {
      return false;
    }

    const lineNumber = editor.getCursor().line;
    const line = editor.getLine(lineNumber);
    const heading = extractHeadingFromLine(line);
    if (!heading) {
      return false;
    }

    if (!checking) {
      this.extractHeading(ctx.file, editor);
    }

    return true;
  }

  private checkOrExecMergeFileCommand(checking: boolean): boolean {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return false;
    }

    if (!isMarkdownFile(this.app, file)) {
      return false;
    }

    if (!checking) {
      this.mergeFile(file);
    }

    return true;
  }

  private checkOrExecSplitFileCommand(checking: boolean, editor: Editor, ctx: MarkdownFileInfo | MarkdownView): boolean {
    if (!ctx.file) {
      return false;
    }

    if (!editor.somethingSelected()) {
      return false;
    }

    if (!checking && this.getAndCheckCorePlugin()) {
      this.splitFile(ctx.file, editor);
    }

    return true;
  }

  private checkOrExecSplitNoteByHeadingsCommand(checking: boolean, editor: Editor, ctx: MarkdownFileInfo | MarkdownView, headingLevel: number): boolean {
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
      invokeAsyncSafely(() => this.splitNoteByHeadings(file, editor, headingLevel));
    }

    return true;
  }

  private extractHeading(file: TFile, editor: Editor): null | SuggestModalBase {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return null;
    }

    const lineNumber = editor.getCursor().line;
    const headingInfo = corePlugin.instance.getSelectionUnderHeading(file, editor, lineNumber);

    if (!headingInfo) {
      new Notice('Failed to find heading');
      return null;
    }

    editor.setSelection(headingInfo.start, headingInfo.end);
    return this.splitFile(file, editor, headingInfo.heading);
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
    const file = info.file;

    if (!file) {
      return;
    }

    if (editor.getSelection().trim()) {
      menu.addItem((item) => {
        return item
          .setTitle('Advanced extract current selection...')
          .setIcon('lucide-git-branch-plus')
          .setSection('selection')
          .onClick(() => {
            this.splitFile(file, editor);
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
          this.extractHeading(file, editor);
        });
    });
  }

  private async handleEnableCorePlugin(next: OnEnableFn): Promise<void> {
    const corePlugin = this.getCorePlugin();
    await next(this.app, corePlugin);
    this.initModals();
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

  private initModals(): void {
    if (this.isModalInitialized) {
      return;
    }

    this.isModalInitialized = true;

    const mergeFileCommand = this.app.commands.findCommand('note-composer:merge-file');
    const splitFileCommand = this.app.commands.findCommand('note-composer:split-file');

    const dummyFile = getFile(this.app, 'DUMMY.md', true);
    tempRegisterFileAndRun(this.app, dummyFile, () => {
      invokeWithPatch(this.app.workspace, {
        getActiveFile: (): GetActiveFileFn => (): TFile => dummyFile
      }, () => {
        let lastModal: Modal | null = null;
        invokeWithPatch(Modal.prototype, {
          open: (next: OpenFn): OpenFn => {
            return function patchedOpen(this: Modal) {
              // eslint-disable-next-line consistent-this, @typescript-eslint/no-this-alias
              lastModal = this;
              next.call(this);
            };
          }
        }, () => {
          mergeFileCommand?.checkCallback?.(false);
          lastModal?.close();
          this.MergeFileSuggestModalConstructor = extendSuggestModal(this, lastModal?.constructor as MergeFileSuggestModalConstructor, true);

          const ctx = {
            app: this.app,
            file: dummyFile,
            hoverPopover: null
          };
          splitFileCommand?.editorCheckCallback?.(false, new DummyEditor(), ctx);
          lastModal?.close();
          this.SplitFileSuggestModalConstructor = extendSuggestModal(this, lastModal?.constructor as SplitFileSuggestModalConstructor, false);
        });
      });
    });
  }

  private mergeFile(file: TFile): void {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    const modal = new this.MergeFileSuggestModalConstructor(this.app, corePlugin.instance);
    modal.setCurrentFile(file);
    modal.open();
  }

  private splitFile(file: TFile, editor: Editor, heading?: string): null | SuggestModalBase {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return null;
    }

    const modal = new this.SplitFileSuggestModalConstructor(this.app, editor, corePlugin.instance, heading);
    modal.setCurrentFile(file);
    modal.open();
    return modal;
  }

  private async splitNoteByHeadings(file: TFile, editor: Editor, headingLevel: number): Promise<void> {
    const corePlugin = this.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    const dummySuggestItem: SuggestItem = {
      downranked: false,
      file,
      match: {
        matches: [],
        score: 0
      },
      type: 'file'
    };

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const cache = await getCacheSafe(this.app, file);
      if (!cache) {
        break;
      }

      const heading = (cache.headings ?? []).filter((h) => h.level === headingLevel).first();
      if (!heading) {
        break;
      }

      editor.setCursor(heading.position.start.line);
      const modal = this.extractHeading(file, editor);
      if (!modal) {
        break;
      }
      modal.close();
      modal.inputEl.value = heading.heading;
      await modal.onChooseSuggestion(
        dummySuggestItem,
        new KeyboardEvent('keydown', {
          ctrlKey: true,
          key: 'Enter'
        })
      );
    }
  }
}

function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}
