import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

interface ExtractBeforeCursorEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class ExtractBeforeCursorEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: ExtractBeforeCursorEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-arrow-up-from-line',
      id: 'extract-before-cursor',
      name: 'Extract before cursor...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const file = ctx.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot extract from file ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    editor.setSelection({ ch: 0, line: 0 }, editor.getCursor());
    const result = await prepareForSplitFile({
      app: this.app,
      editor,
      resourceLockComponent: this.resourceLockComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
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
      resourceLockComponent: this.resourceLockComponent,
      frontmatterMergeStrategy: result.frontmatterMergeStrategy,
      insertMode: result.insertMode,
      isMultipleSplit: false,
      isNewTargetFile: result.isNewTargetFile,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      selectedText: result.selectedText,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldIncludeFrontmatter: result.shouldIncludeFrontmatter,
      shouldMergeHeadings: result.shouldMergeHeadings,
      sourceFile: file,
      targetFile: result.targetFile
    });
    await composer.splitFile();
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
