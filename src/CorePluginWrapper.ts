import type { App } from 'obsidian';
import type { NoteComposerPlugin } from 'obsidian-typings';

import { Notice } from 'obsidian';
import { InternalPluginName } from 'obsidian-typings/implementations';

export class CorePluginWrapper {
  public constructor(private readonly app: App) {
  }

  public getAndCheckCorePlugin(): NoteComposerPlugin | null {
    const corePlugin = this.getCorePlugin();
    if (!corePlugin.enabled) {
      new Notice('Note composer Core plugin is not enabled');
      return null;
    }
    return corePlugin;
  }

  public getCorePlugin(): NoteComposerPlugin {
    const noteComposerPlugin = this.app.internalPlugins.getPluginById(InternalPluginName.NoteComposer);
    if (!noteComposerPlugin) {
      throw new Error('Note composer Core plugin not found');
    }
    return noteComposerPlugin;
  }
}
