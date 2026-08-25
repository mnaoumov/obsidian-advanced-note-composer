import type {
  App,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../command-menu-placement.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { CommandCategory } from '../plugin-settings.ts';
import { updateHeadingBacklinks } from '../rename-heading.ts';

interface RenameHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Renames the heading on the cursor line and updates every link across the vault whose subpath
 * references that heading — including NESTED subpaths where the heading is only a middle segment (e.g.
 * `[[note#Second Concept#Definition]]` when `Second Concept` is renamed), which Obsidian's built-in
 * `rename this heading` command leaves broken (GitHub issue #111). Prompts for the new heading text and
 * performs the source-note edit inside a reversible resource-locked transaction, then rewrites the
 * matching backlinks.
 *
 * Duplicate-heading note: matching is by heading TEXT (mirroring Obsidian's own heading-link
 * normalization), so if a note has two identically-named headings, links to either are updated — the
 * same limitation Obsidian's built-in command has for single-segment links.
 */
export class RenameHeadingEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private headingCache?: HeadingCache;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: RenameHeadingEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-edit-3',
      id: 'rename-heading',
      name: 'Rename heading...'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.Rename, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }

    const file = context.file;
    if (!file) {
      return false;
    }

    const cursorLine = editor.getCursor().line;
    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    const headingCache = headings.find((heading) => heading.position.start.line === cursorLine);
    if (!headingCache) {
      return false;
    }

    this.headingCache = headingCache;
    return true;
  }

  protected override async executeEditor(_editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot rename a heading in file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const headingCache = this.headingCache;
    if (!headingCache) {
      return;
    }

    const oldHeading = headingCache.heading;
    const newHeading = await prompt({
      app: this.app,
      defaultValue: oldHeading,
      okButtonText: 'Rename',
      placeholder: 'New heading',
      title: 'Rename heading'
    });

    if (newHeading === null || ['', oldHeading].includes(newHeading)) {
      return;
    }

    const content = await this.app.vault.read(file);
    const newHeadingLine = `${'#'.repeat(headingCache.level)} ${newHeading}`;
    const newContent = content.slice(0, headingCache.position.start.offset)
      + newHeadingLine
      + content.slice(headingCache.position.end.offset);

    const abortController = new AbortController();
    let updatedLinkCount = 0;
    const progressNotice = showOperationProgressNotice({
      abortController,
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          sourcePathOrAbstractFile: file,
          verb: 'Renaming heading in note'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          await vaultTransaction.modify(file, newContent);
          updatedLinkCount = await updateHeadingBacklinks({
            abortSignal: abortController.signal,
            app: this.app,
            newHeading,
            notePathOrFile: file,
            oldHeading,
            pluginNoticeComponent: this.pluginNoticeComponent,
            resourceLockComponent: this.resourceLockComponent
          });
        },
        lockTargets: [{ mode: 'file', pathOrFile: file }],
        operationName: 'Rename heading',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back. The
        // Progress notice's Cancel button is what makes this reachable at all.
        return;
      }
      throw error;
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    // One notice rather than two: the updated-link count is a detail OF the rename, not a separate
    // Operation, and it is omitted entirely when nothing linked to the heading.
    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourcePathOrAbstractFile: file,
        suffix: updatedLinkCount > 0 ? ` and updated ${String(updatedLinkCount)} link(s)` : '',
        verb: `Renamed heading "${oldHeading}" to "${newHeading}" in note`
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return checkShouldAddCommandToEditorMenu({
      commandCategory: CommandCategory.Rename,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(_view: MarkdownView, mode: string, _source: string): boolean {
    return checkShouldAddCommandToViewportMenu({
      commandCategory: CommandCategory.Rename,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }
}
