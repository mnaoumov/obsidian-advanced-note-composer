import { PluginSettingsBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsBase';

export class AdvancedNoteComposerPluginSettings extends PluginSettingsBase {
  public replacement = '_';
  public shouldAddInvalidTitleToFrontmatterTitleKey = true;
  public shouldAddInvalidTitleToNoteAlias = true;
  public shouldReplaceInvalidTitleCharacters = true;

  public constructor(data: unknown) {
    super();
    this.init(data);
  }
}
