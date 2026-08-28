import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionAnchorComponent } from '../selection-anchor-component.ts';

import { SelectEditorCommandHandlerBase } from './select-editor-command-handler-base.ts';

interface CancelSelectionEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly selectionAnchorComponent: SelectionAnchorComponent;
}

/**
 * Drops the anchor without selecting anything (issue #266) — the way out of a `Start selection` the user
 * has changed their mind about, mirroring `Smart cut & paste: Cancel move`.
 *
 * An EDITOR command rather than a global one like `Cancel move`, so it shares the anchor pair's category,
 * its context-menu placement and its availability gate — and so it sits beside the other two on the
 * mobile toolbar instead of being the odd one out.
 */
export class CancelSelectionEditorCommandHandler extends SelectEditorCommandHandlerBase {
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly selectionAnchorComponent: SelectionAnchorComponent;

  public constructor(params: CancelSelectionEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-x',
      id: 'cancel-selection',
      name: 'Selection anchor: Cancel selection',
      pluginSettingsComponent: params.pluginSettingsComponent
    });

    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.selectionAnchorComponent = params.selectionAnchorComponent;
  }

  protected override canSelect(_editor: Editor, context: MarkdownFileInfo): boolean {
    return this.selectionAnchorComponent.hasAnchor(context.file);
  }

  protected override executeEditor(): void {
    this.selectionAnchorComponent.clearAnchor();
    this.pluginNoticeComponent.showNotice('Cancelled the selection anchor.');
  }
}
