import type {
  App,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import {
  hasReorderableSiblings,
  joinReorderedSections,
  splitIntoReorderableSections
} from '../heading-sections.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { openReorderHeadingsModal } from '../modals/reorder-headings-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { CommandCategory } from '../plugin-settings.ts';
import { ActiveEditorCommandHandlerBase } from './active-editor-command-handler-base.ts';

interface ReorderHeadingsEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Reorders a note's heading sections at any nesting level. Opens a modal listing the whole heading tree
 * as an indented list; the user moves each heading (and everything nested under it) up or down among its
 * same-parent siblings; on confirm the note is rewritten with the sections in the chosen order, nested
 * subheadings preserved, inside a reversible resource-locked transaction.
 */
export class ReorderHeadingsEditorCommandHandler extends ActiveEditorCommandHandlerBase {
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: ReorderHeadingsEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-ordered',
      id: 'reorder-headings',
      name: 'Reorder headings...'
    });

    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(_editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.Reorder, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }
    const file = context.file;
    if (!file) {
      return false;
    }
    return hasReorderableSiblings(this.getHeadings(file));
  }

  protected override async executeEditor(_editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot reorder headings in file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const content = await this.app.vault.read(file);
    const split = splitIntoReorderableSections(content, this.getHeadings(file));

    const order = await openReorderHeadingsModal({ app: this.app, split });
    if (!order) {
      return;
    }
    if (order.every((sectionIndex, position) => sectionIndex === position)) {
      return;
    }

    const newContent = joinReorderedSections(split, order);
    // Hoisted out of the `runLockedTransaction` call so the progress notice's Cancel button has a
    // Controller to abort.
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
          verb: 'Reordering headings in note'
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
        },
        lockTargets: [{ mode: 'file', pathOrFile: file }],
        operationName: 'Reorder headings',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return;
      }
      throw error;
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourcePathOrAbstractFile: file,
        verb: 'Reordered headings in note'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }

  private getHeadings(file: TFile): readonly HeadingCache[] {
    return this.app.metadataCache.getFileCache(file)?.headings ?? [];
  }
}
