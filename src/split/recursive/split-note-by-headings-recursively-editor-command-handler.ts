import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  CachedMetadata,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  TFile
} from 'obsidian';

import type { BulkOperationRunner } from '../../bulk-operations/bulk-operation-runner.ts';
import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { RecursiveSplitRun } from './split-recursively-editor-command-handler-base.ts';

import { isEditorCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import { buildRecursiveSplitPreviewRows } from './heading-split-recursion.ts';
import { SplitRecursivelyEditorCommandHandlerBase } from './split-recursively-editor-command-handler-base.ts';

interface SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly bulkOperationRunner: BulkOperationRunner;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class SplitNoteByHeadingsRecursivelyEditorCommandHandler extends SplitRecursivelyEditorCommandHandlerBase {
  public constructor(params: SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      bulkOperationRunner: params.bulkOperationRunner,
      consoleDebugComponent: params.consoleDebugComponent,
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-tree',
      id: 'split-note-by-headings-recursively',
      name: 'Split note by headings recursively...',
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent,
      resourceLockComponent: params.resourceLockComponent
    });
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
    if (!cache) {
      return false;
    }
    // Unlike the level-scoped commands, this one is not tied to the cursor: it restructures the whole
    // note, so any heading anywhere in it is enough.
    return (cache.headings ?? []).length > 0;
  }

  protected override resolveRun(editor: Editor, _file: TFile, cache: CachedMetadata): null | RecursiveSplitRun {
    const headings = cache.headings ?? [];
    if (headings.length === 0) {
      return null;
    }
    return {
      completionVerb: 'Split note',
      dialogTitle: 'Split note recursively',
      // The whole note is the subject, so the dialog names no heading.
      headingText: null,
      previewRows: buildRecursiveSplitPreviewRows(editor.getValue(), headings),
      progressVerb: 'Splitting note recursively',
      // Every heading at the shallowest level the note has, then each of their siblings in turn.
      rootHeadingLine: null
    };
  }

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    /*
     * A user who made a selection is asking about that selection, so a whole-note command has no business
     * in that context menu (issue #188) — `Extract current selection...` is the one that belongs there.
     * Deliberately NOT in `canExecuteEditor`: unlike the level-scoped gate of issue #94, this only hides the
     * menu item, so the palette command and any hotkey keep working while a selection is active.
     */
    return !editor.somethingSelected() && checkShouldAddCommandToEditorMenu({
      commandId: this.id,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(view: MarkdownView, mode: string, _source: string): boolean {
    /*
     * The command issue #252 was filed about: the reporter wanted it off the editor menu and onto the empty
     * margin `Readable line length` leaves beside the text. The selection gate above is about which command
     * the user means rather than about which menu was raised, so it holds here too.
     */
    return !view.editor.somethingSelected() && checkShouldAddCommandToViewportMenu({
      commandId: this.id,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }
}
