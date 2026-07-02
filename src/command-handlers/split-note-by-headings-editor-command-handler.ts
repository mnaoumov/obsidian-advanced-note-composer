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
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { Level } from '../markdown-heading-document.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

interface SplitNoteByHeadingsEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly headingLevel: Level;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class SplitNoteByHeadingsEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly headingLevel: Level;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

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

  protected override canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean {
    super.canExecuteEditor(editor, ctx);
    const file = ctx.file;
    if (!file) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return false;
    }
    const headings = cache.headings?.filter((heading) => heading.level === this.headingLevel);
    if (!headings || headings.length === 0) {
      return false;
    }
    return true;
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

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- No better way for infinite loop.
    while (true) {
      const cache = await getCacheSafe(this.app, file);
      if (!cache) {
        break;
      }
      const heading = (cache.headings ?? []).find((h) => h.level === this.headingLevel);
      if (!heading) {
        break;
      }
      const headingInfo = getSelectionUnderHeading(this.app, file, editor, heading.position.start.line);
      if (!headingInfo) {
        this.pluginNoticeComponent.showNotice('Failed to find heading');
        return;
      }
      editor.setSelection(headingInfo.start, headingInfo.end);
      const result = await prepareForSplitFile({
        app: this.app,
        editor,
        resourceLockComponent: this.resourceLockComponent,
        heading: headingInfo.heading,
        pluginSettingsComponent: this.pluginSettingsComponent,
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
        resourceLockComponent: this.resourceLockComponent,
        heading: headingInfo.heading,
        isMultipleSplit: true,
        isNewTargetFile: result.isNewTargetFile,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent,
        selectedText: result.selectedText,
        sourceFile: file,
        targetFile: result.targetFile
      });
      await composer.splitFile();
    }
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, ctx: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, ctx);
    return true;
  }
}
