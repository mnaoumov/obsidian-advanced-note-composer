import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { stripHeadingForLink } from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { resolveEnclosingHeadingInfo } from '../select-ranges.ts';
import { SelectEditorCommandHandlerBase } from './select-editor-command-handler-base.ts';

interface CopyLinkToThisHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Copies a link to the heading the cursor is under (issue #291).
 *
 * The link itself is nothing new — it is exactly what Obsidian writes when you pick that heading from the
 * `[[#` suggester, produced by Obsidian's own `generateMarkdownLink` so the vault's `New link format` and
 * `Use [[Wikilinks]]` settings decide its shape. What the issue asked THIS plugin for is the other half:
 * such a link surviving the plugin's own restructuring, which {@link ComposerBase} does for every heading
 * and block link, however it was written. The command is here so the link is one keystroke away from the
 * heading it names, resolved by the same enclosing-heading rule as `Extract this heading...`.
 *
 * It lives in the {@link CommandCategory.Select} category, with the other commands that act on the editor
 * and write nothing to the vault.
 */
export class CopyLinkToThisHeadingEditorCommandHandler extends SelectEditorCommandHandlerBase {
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: CopyLinkToThisHeadingEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-link',
      id: 'copy-link-to-this-heading',
      name: 'Copy link to this heading',
      pluginSettingsComponent: params.pluginSettingsComponent
    });
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  protected override canSelect(editor: Editor, context: MarkdownFileInfo): boolean {
    return this.buildLink(editor, context) !== null;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const link = this.buildLink(editor, context);
    if (link === null) {
      return;
    }

    await activeWindow.navigator.clipboard.writeText(link);
    this.pluginNoticeComponent.showNotice(`Copied ${link}`);
  }

  /**
   * Builds the link to the heading the cursor is under.
   *
   * @param editor - The editor instance.
   * @param context - The markdown file context.
   * @returns The link, or `null` when the cursor is not under a heading.
   */
  private buildLink(editor: Editor, context: MarkdownFileInfo): null | string {
    const file = context.file;
    if (!file) {
      return null;
    }

    const headingInfo = resolveEnclosingHeadingInfo({ app: this.app, editor, file });
    if (!headingInfo) {
      return null;
    }

    return this.app.fileManager.generateMarkdownLink(file, file.path, `#${stripHeadingForLink(headingInfo.heading)}`);
  }
}
