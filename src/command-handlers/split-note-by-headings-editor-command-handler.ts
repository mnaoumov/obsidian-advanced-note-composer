import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { Level } from '../markdown-heading-document.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { doesSelectionIntersectHeadingOfLevel } from '../headings.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';

interface SplitNoteByHeadingsEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly headingLevel: Level;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class SplitNoteByHeadingsEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly headingLevel: Level;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SplitNoteByHeadingsEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors-line-dashed',
      id: `split-note-by-headings-h${String(params.headingLevel)}`,
      name: `Split note by headings - H${String(params.headingLevel)}`
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.headingLevel = params.headingLevel;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    super.canExecuteEditor(editor, context);
    if (isEditorCommandBlocked(this.pluginSettingsComponent, context)) {
      return false;
    }
    const file = context.file;
    if (!file) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return false;
    }
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    return doesSelectionIntersectHeadingOfLevel({
      headings: cache.headings ?? [],
      level: this.headingLevel,
      selectionEndLine: to.line,
      selectionStartLine: from.line
    });
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot split file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    // The individual splits are silent (`isMultipleSplit`), so the batch reports itself once — a progress
    // Notice for the whole run and one completion notice naming how many notes it produced (issue #182).
    const abortController = new AbortController();
    const progressNotice = showOperationProgressNotice({
      abortController,
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          sourcePathOrAbstractFile: file,
          verb: `Splitting note by H${String(this.headingLevel)} headings in`
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    // Collected rather than counted: the completion notice names the notes it created, in the order they
    // Were created (issue #235), and their number is the count it always reported.
    const createdFiles: TFile[] = [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- No better way for infinite loop.
      while (true) {
        if (abortController.signal.aborted) {
          break;
        }
        const cache = await getCacheSafe(this.app, file);
        if (!cache) {
          break;
        }
        const heading = (cache.headings ?? []).find((h) => h.level === this.headingLevel);
        if (!heading) {
          break;
        }
        const headingInfo = getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: heading.position.start.line });
        if (!headingInfo) {
          this.pluginNoticeComponent.showNotice('Failed to find heading');
          return;
        }
        editor.setSelection(headingInfo.start, headingInfo.end);
        const result = await prepareForSplitFile({
          app: this.app,
          editor,
          heading: headingInfo.heading,
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
          heading: headingInfo.heading,
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
        createdFiles.push(result.targetFile);
      }
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    if (createdFiles.length > 0) {
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
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    return true;
  }
}
