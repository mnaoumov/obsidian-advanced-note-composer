import { PluginSettingsBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsBase';

export enum InvalidCharacterAction {
  Remove = 'Remove',
  Replace = 'Replace'
}

export class AdvancedNoteComposerPluginSettings extends PluginSettingsBase {
  public invalidCharacterAction = InvalidCharacterAction.Remove;
  public replacementCharacter = '_';
  public constructor(data: unknown) {
    super();
    this.init(data);
  }
}
