import type {
  App,
  CachedMetadata,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { RecursiveSplitRun } from './split-recursively-editor-command-handler-base.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import { buildRecursiveSplitPreviewRows } from '../heading-split-recursion.ts';
import { CommandCategory } from '../plugin-settings.ts';
import { SplitRecursivelyEditorCommandHandlerBase } from './split-recursively-editor-command-handler-base.ts';

interface SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class SplitNoteByHeadingsRecursivelyEditorCommandHandler extends SplitRecursivelyEditorCommandHandlerBase {
  public constructor(params: SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
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
    // Note, so any heading anywhere in it is enough.
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
    return !editor.somethingSelected();
  }
}
