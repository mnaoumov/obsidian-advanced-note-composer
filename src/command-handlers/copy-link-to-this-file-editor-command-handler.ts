import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { SelectEditorCommandHandlerBase } from './select-editor-command-handler-base.ts';

interface CopyLinkToThisFileEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Copies a link to the note being edited (issue #308), the note-level sibling of
 * {@link CopyLinkToThisHeadingEditorCommandHandler}.
 *
 * The reporter's use case is a link to the current note written into a section that will later be split
 * out: the link has to keep naming THIS note once the section lives elsewhere, which every split already
 * guarantees, because the composer re-resolves each link the extracted text carries against the note it
 * came from. So the command only has to produce the link, and it does that with Obsidian's own
 * `generateMarkdownLink`, so the vault's `New link format` and `Use [[Wikilinks]]` settings decide its shape.
 *
 * It lives in the {@link CommandCategory.Select} category, with the other commands that act on the editor
 * and write nothing to the vault.
 */
export class CopyLinkToThisFileEditorCommandHandler extends SelectEditorCommandHandlerBase {
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: CopyLinkToThisFileEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-link',
      id: 'copy-link-to-this-file',
      name: 'Copy link to this file',
      pluginSettingsComponent: params.pluginSettingsComponent
    });
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  protected override canSelect(_editor: Editor, context: MarkdownFileInfo): boolean {
    return this.buildLink(context) !== null;
  }

  protected override async executeEditor(_editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const link = this.buildLink(context);
    if (link === null) {
      return;
    }

    await activeWindow.navigator.clipboard.writeText(link);
    this.pluginNoticeComponent.showNotice(`Copied ${link}`);
  }

  /**
   * Builds the link to the note being edited.
   *
   * @param context - The markdown file context.
   * @returns The link, or `null` when the editor has no file.
   */
  private buildLink(context: MarkdownFileInfo): null | string {
    const file = context.file;
    return file ? this.app.fileManager.generateMarkdownLink(file, file.path) : null;
  }
}
