import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';

import type { AdvancedNoteComposerPlugin } from './AdvancedNoteComposerPlugin.ts';

export class AdvancedNoteComposerPluginSettingsTab extends PluginSettingsTabBase<AdvancedNoteComposerPlugin> {
  public override display(): void {
    this.containerEl.empty();
  }
}
