import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  TFile
} from 'obsidian';

import { EditorCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/editor-command-handler';
import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';

import { isEditorCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import {
  buildOperationNoticeContent,
  disposeOperationProgressNotice,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../../ui/operation-notices.ts';
import { prepareForSplitFile } from '../picker/split-file-modal.ts';
import { SplitComposer } from '../split-composer.ts';
import { getHorizontalRuleBlocks } from './horizontal-rules.ts';

interface SplitNoteByHorizontalRulesEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Split note by horizontal rules`: every block between two horizontal rules (or a rule and the start or end
 * of the note) becomes a note of its own, named after the block's first heading, else its first line. The
 * batch sibling of `Extract between horizontal rules`, and shaped like `Split note by headings`: no picker,
 * the same residual (`Text after extraction`) and the same confirmation rule. The idea comes from the
 * `Splitsmith` plugin (MIT); no code of it is used.
 */
export class SplitNoteByHorizontalRulesEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SplitNoteByHorizontalRulesEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors-line-dashed',
      id: 'split-note-by-horizontal-rules',
      name: 'Split note by horizontal rules'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    super.canExecuteEditor(editor, context);
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.SplitAndExtract, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }
    const file = context.file;
    if (!file) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    return !!cache && getHorizontalRuleBlocks({ cache, lines: editor }).length > 0;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    const cache = await getCacheSafe(this.app, file);
    if (!cache) {
      return;
    }
    const blocks = getHorizontalRuleBlocks({ cache, lines: editor });
    if (blocks.length === 0) {
      this.pluginNoticeComponent.showNotice('The note has no content between horizontal rules');
      return;
    }

    /*
     * No `abortController`, so no Cancel (issue #289): each block is split in its own transaction, so a
     * cancel could only stop between two of them.
     */
    const progressNotice = showOperationProgressNotice({
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          sourcePathOrAbstractFile: file,
          verb: 'Splitting note by horizontal rules in'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    const createdFiles: TFile[] = [];

    try {
      /*
       * The blocks are positions read once, before anything changes, so they are split from the LAST one up:
       * each split rewrites only its own block (and what follows it), so every block above it keeps the
       * lines it was read at.
       */
      for (const [index, block] of [...blocks.entries()].reverse()) {
        const name = block.name || `${file.basename} ${String(index + 1)}`;
        editor.setSelection(block.start, block.end);
        const result = await prepareForSplitFile({
          app: this.app,
          editor,
          heading: name,
          pluginNoticeComponent: this.pluginNoticeComponent,
          pluginSettingsComponent: this.pluginSettingsComponent,
          resourceLockComponent: this.resourceLockComponent,
          shouldSkipModal: true,
          sourceFile: file
        });
        if (!result) {
          return;
        }
        const composer = new SplitComposer({
          app: this.app,
          capturedSelections: result.capturedSelections,
          consoleDebugComponent: this.consoleDebugComponent,
          editor,
          heading: name,
          isMultipleSplit: true,
          isNewTargetFile: result.isNewTargetFile,
          pluginNoticeComponent: this.pluginNoticeComponent,
          pluginSettingsComponent: this.pluginSettingsComponent,
          resourceLockComponent: this.resourceLockComponent,
          selectedText: result.selectedText,
          sourceFile: file,
          targetFile: result.targetFile
        });
        await composer.splitFile();
        createdFiles.unshift(result.targetFile);
      }
    } finally {
      disposeOperationProgressNotice(progressNotice);
    }

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        createdPathsOrAbstractFiles: createdFiles,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourcePathOrAbstractFile: file,
        suffix: ` into ${String(createdFiles.length)} note(s)`,
        verb: 'Split note'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() || this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    return checkShouldAddCommandToEditorMenu({
      commandId: this.id,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(_view: MarkdownView, mode: string, _source: string): boolean {
    return checkShouldAddCommandToViewportMenu({
      commandId: this.id,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }
}
