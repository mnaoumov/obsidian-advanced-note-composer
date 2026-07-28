import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { MarkdownView } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { RecursiveSplitPreviewRow } from '../heading-split-recursion.ts';
import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import {
  buildRecursiveSplitPreviewRows,
  findNextHeadingToSplit,
  MAX_HEADING_LEVEL
} from '../heading-split-recursion.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { openModal } from '../open-minimizable-modal.ts';

interface BuildRecursiveSplitConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly previewRows: readonly RecursiveSplitPreviewRow[];
  readonly sourceFile: TFile;
}

/**
 * A note produced by one pass of the recursive split, plus the level of the heading it came from — which
 * is what bounds the next pass (see {@link findNextHeadingToSplit}).
 */
interface RecursiveSplitChild {
  readonly file: TFile;
  readonly level: number;
}

interface SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface SplitNoteByHeadingsRecursivelyEditorCommandHandlerSplitBranchParams {
  readonly editor: Editor;
  readonly file: TFile;

  /**
   * The shallowest heading level this pass may extract. `1` for the note the command was invoked on;
   * the parent heading's level plus one for every note the split itself produced.
   */
  readonly minLevel: number;
}

const PREVIEW_INDENT = '    ';

export class SplitNoteByHeadingsRecursivelyEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-tree',
      id: 'split-note-by-headings-recursively',
      name: 'Split note by headings recursively...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean {
    super.canExecuteEditor(editor, ctx);
    if (isEditorCommandBlocked(this.pluginSettingsComponent, ctx)) {
      return false;
    }
    const file = ctx.file;
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

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const file = ctx.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot split file ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const cache = await getCacheSafe(this.app, file);
    if (!cache) {
      return;
    }
    const headings = cache.headings ?? [];
    if (headings.length === 0) {
      return;
    }

    if (this.pluginSettingsComponent.settings.shouldAskBeforeSplitting) {
      const previewRows = buildRecursiveSplitPreviewRows(editor.getValue(), headings);
      const confirmResult = await this.confirmRecursiveSplit(file, previewRows);
      if (!confirmResult.isConfirmed) {
        return;
      }
      await this.pluginSettingsComponent.editAndSave((settings) => {
        settings.shouldAskBeforeSplitting = confirmResult.shouldAskAgain;
      });
    }

    try {
      const createdCount = await this.splitBranch({ editor, file, minLevel: 1 });
      this.pluginNoticeComponent.showNotice(`Split into ${String(createdCount)} note(s).`);
    } finally {
      /*
       * The recursion walks the leaf down through every note it creates, so it ends up parked on the
       * deepest one. Bring the user back to the note they invoked the command on, whether the run
       * finished or failed part-way.
       */
      await this.app.workspace.getLeaf(false).openFile(file, { active: true });
    }
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, ctx: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, ctx);
    return true;
  }

  /**
   * Asks once, up front, before restructuring the whole note. The individual splits that follow are
   * confirmation-free (`shouldSkipConfirmation`): a deep note produces many of them, and confirming each
   * would be unusable. Mirrors the other flows in mapping "Don't ask again" back onto
   * `shouldAskBeforeSplitting`.
   *
   * @param sourceFile - The note being split.
   * @param previewRows - The notes that will be created, in document order.
   * @returns The dialog result.
   */
  private async confirmRecursiveSplit(sourceFile: TFile, previewRows: readonly RecursiveSplitPreviewRow[]): Promise<ConfirmDialogModalResult> {
    const app = this.app;
    return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openModal(
        new ConfirmDialogModal({
          app,
          buildContent: (fragment): Promise<void> => buildRecursiveSplitConfirmContent({ app, fragment, previewRows, sourceFile }),
          // There is no target to reselect: every target is derived from a heading.
          canReselectTarget: false,
          confirmButtonMobileText: 'Split and don\'t ask again',
          confirmButtonText: 'Split',
          promiseResolve,
          title: 'Split note recursively'
        })
      );
    });
  }

  /**
   * Opens a note produced by the split so the next pass has an editor to work in. {@link SplitComposer}
   * drives the source through the editor (it is the editor selection that gets replaced by the residual
   * link), so a note cannot be split without being open.
   *
   * @param file - The note to open.
   * @returns Its editor, or `null` when the note did not open as a markdown view.
   */
  private async openAndGetEditor(file: TFile): Promise<Editor | null> {
    await this.app.workspace.getLeaf(false).openFile(file, { active: true });
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.editor ?? null;
  }

  /**
   * Splits one note into its heading-named children, then recurses into each of them — which is what turns
   * a heading hierarchy into a folder hierarchy.
   *
   * Each pass extracts a heading together with its whole subtree (`getSelectionUnderHeading` stops at the
   * next equal-or-higher heading), into a new note forced both into the source note's own folder and into
   * a folder of its own. So a child of `<dir>/A/A.md` lands at `<dir>/A/B/B.md`, and the nesting comes out
   * of the existing split machinery rather than from any path arithmetic here.
   *
   * @param params - The parameters.
   * @returns How many notes were created, including those created by the recursive passes.
   */
  private async splitBranch(params: SplitNoteByHeadingsRecursivelyEditorCommandHandlerSplitBranchParams): Promise<number> {
    const { editor, file, minLevel } = params;
    const children: RecursiveSplitChild[] = [];
    let createdCount = 0;

    for (;;) {
      const cache = await getCacheSafe(this.app, file);
      if (!cache) {
        break;
      }
      const heading = findNextHeadingToSplit(cache.headings ?? [], minLevel);
      if (!heading) {
        break;
      }
      const headingInfo = getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: heading.position.start.line });
      if (!headingInfo) {
        this.pluginNoticeComponent.showNotice('Failed to find heading');
        return createdCount;
      }
      editor.setSelection(headingInfo.start, headingInfo.end);
      const result = await prepareForSplitFile({
        app: this.app,
        editor,
        heading: headingInfo.heading,
        pluginSettingsComponent: this.pluginSettingsComponent,
        resourceLockComponent: this.resourceLockComponent,
        shouldForceAllowOnlyCurrentFolder: true,
        shouldForceSplitIntoFolder: true,
        shouldSkipConfirmation: true,
        shouldSkipModal: true,
        sourceFile: file
      });
      if (!result) {
        return createdCount;
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
      createdCount++;
      children.push({ file: result.targetFile, level: heading.level });
    }

    for (const child of children) {
      if (child.level >= MAX_HEADING_LEVEL) {
        continue;
      }
      const childEditor = await this.openAndGetEditor(child.file);
      if (!childEditor) {
        continue;
      }
      createdCount += await this.splitBranch({ editor: childEditor, file: child.file, minLevel: child.level + 1 });
    }

    return createdCount;
  }
}

async function buildRecursiveSplitConfirmContent(params: BuildRecursiveSplitConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    previewRows,
    sourceFile
  } = params;
  fragment.appendText('Are you sure you want to split ');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' into a folder tree of ');
  appendCodeBlock(fragment, String(previewRows.length));
  fragment.appendText(' notes?');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(': ');
  fragment.appendChild(await renderInternalLink({ app, pathOrAbstractFile: sourceFile }));
  fragment.createEl('br');
  fragment.createEl('br');
  fragment.createEl('h2', { text: 'Notes that will be created' });
  for (const row of previewRows) {
    appendCodeBlock(fragment, `${PREVIEW_INDENT.repeat(row.depth)}${row.headingText}`);
    fragment.createEl('br');
  }
}
