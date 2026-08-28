import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionAnchorComponent } from '../selection-anchor-component.ts';

import { SelectEditorCommandHandlerBase } from './select-editor-command-handler-base.ts';

interface StartSelectionEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly selectionAnchorComponent: SelectionAnchorComponent;
}

/**
 * Anchors one end of a selection at the cursor (issue #266). `Selection anchor: End selection` selects
 * from here to wherever the cursor is then.
 *
 * **This is the half of the feature that covers ranges nothing else can.** The five per-shape selects
 * cover the shapes markdown knows about; the anchor pair covers an ARBITRARY range, which is what the
 * reporter is actually short of on Android — tapping to place a caret is reliable there, dragging the two
 * selection handles is the gesture that fails him roughly four times in five. Anchor, tap the far end,
 * end: two taps and no dragging.
 *
 * Shipped as two named commands rather than one toggle on purpose. Both are meant to live on Obsidian's
 * mobile toolbar (Settings → Mobile → manage toolbar options), where two labelled buttons beat one button
 * whose meaning depends on hidden state — and where "have I anchored yet?" would otherwise be
 * unanswerable without hunting for the marker.
 */
export class StartSelectionEditorCommandHandler extends SelectEditorCommandHandlerBase {
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly selectionAnchorComponent: SelectionAnchorComponent;

  public constructor(params: StartSelectionEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-text-cursor',
      id: 'start-selection',
      name: 'Selection anchor: Start selection',
      pluginSettingsComponent: params.pluginSettingsComponent
    });

    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.selectionAnchorComponent = params.selectionAnchorComponent;
  }

  protected override canSelect(_editor: Editor, context: MarkdownFileInfo): boolean {
    return !!context.file;
  }

  protected override executeEditor(editor: Editor, context: MarkdownFileInfo): void {
    const file = context.file;
    if (!file) {
      return;
    }

    this.selectionAnchorComponent.setAnchor(editor, file);
    this.pluginNoticeComponent.showNotice('Selection started. Move the cursor and run "Selection anchor: End selection".');
  }
}
