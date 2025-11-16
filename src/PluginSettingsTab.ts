import { getDebugController } from 'obsidian-dev-utils/Debug';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';

import type { PluginTypes } from './PluginTypes.ts';

import {
  FrontmatterMergeStrategy,
  TextAfterExtractionMode
} from './PluginSettings.ts';
import { TOKENIZED_STRING_LANGUAGE } from './PrismComponent.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
    this.containerEl.empty();

    new SettingEx(this.containerEl)
      .setName('Should replace invalid characters')
      .setDesc(createFragment((f) => {
        f.appendText('Whether to replace invalid characters in the title.');
        f.createEl('br');
        f.appendText('If disabled, the error will be shown for invalid titles.');
      }))
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldReplaceInvalidTitleCharacters', {
          onChanged: () => {
            this.display();
          }
        });
      });

    new SettingEx(this.containerEl)
      .setName('Replacement string')
      .setDesc(createFragment((f) => {
        f.appendText('String to replace invalid characters with.');
        f.createEl('br');
        f.appendText('Leave blank to remove invalid characters.');
      }))
      .addText((text) => {
        this.bind(text, 'replacement', {
          shouldResetSettingWhenComponentIsEmpty: false
        });
        text.setDisabled(!this.plugin.settings.shouldReplaceInvalidTitleCharacters);
      });

    new SettingEx(this.containerEl)
      .setName('Should add invalid title to note aliases')
      .setDesc('Whether to add invalid title to the note alias.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAddInvalidTitleToNoteAlias');
      });

    new SettingEx(this.containerEl)
      .setName('Should add invalid title to frontmatter title key')
      .setDesc('Whether to add invalid title to the frontmatter title key.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAddInvalidTitleToFrontmatterTitleKey');
      });

    new SettingEx(this.containerEl)
      .setName('Should open note after merge')
      .setDesc('Whether to open the note after merge.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldOpenNoteAfterMerge');
      });

    new SettingEx(this.containerEl)
      .setName('Should include frontmatter when splitting by default')
      .setDesc('Whether to include frontmatter when splitting by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldIncludeFrontmatterWhenSplittingByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should treat title as path by default')
      .setDesc('Whether to treat title as path by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldTreatTitleAsPathByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should fix footnotes by default')
      .setDesc('Whether to fix footnotes by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldFixFootnotesByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should allow only current folder by default')
      .setDesc('Whether to allow only current folder by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAllowOnlyCurrentFolderByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should merge headings by default')
      .setDesc('Whether to merge headings by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldMergeHeadingsByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should allow split into unresolved path by default')
      .setDesc('Whether to allow split into unresolved path by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAllowSplitIntoUnresolvedPathByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Default frontmatter merge strategy')
      .setDesc(createFragment((f) => {
        f.appendText('When merging frontmatter values from note A to note B:');
        f.createEl('br');
        appendCodeBlock(f, 'Merge and prefer new values');
        f.appendText(' - copy values from A to B that were not in B yet, and overwrite existing values in B with values from A.');
        f.createEl('br');
        appendCodeBlock(f, 'Merge and prefer original values');
        f.appendText(' - copy values from A to B that were not in B yet, and keep existing values in B.');
        f.createEl('br');
        appendCodeBlock(f, 'Keep original frontmatter');
        f.appendText(' - keep existing values in B, and ignore values from A.');
        f.createEl('br');
        appendCodeBlock(f, 'Replace with new frontmatter');
        f.appendText(' - remove existing values in B, and copy values from A to B.');
        f.createEl('br');
        appendCodeBlock(f, 'Preserve both original and new frontmatter');
        f.appendText(' - copies new frontmatter from A into a separate frontmatter key in B.');
        f.createEl('br');
      }))
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
          [FrontmatterMergeStrategy.MergeAndPreferNewValues]: 'Merge and prefer new values',
          [FrontmatterMergeStrategy.MergeAndPreferOriginalValues]: 'Merge and prefer original values',
          [FrontmatterMergeStrategy.KeepOriginalFrontmatter]: 'Keep original frontmatter',
          [FrontmatterMergeStrategy.ReplaceWithNewFrontmatter]: 'Replace with new frontmatter',
          [FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter]: 'Preserve both original and new frontmatter'
          /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
        });
        this.bind(dropdown, 'defaultFrontmatterMergeStrategy');
      });

    new SettingEx(this.containerEl)
      .setName('Should ask before merging')
      .setDesc('Whether to ask before merging notes.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAskBeforeMerging');
      });

    new SettingEx(this.containerEl)
      .setName('Text after extraction')
      .setDesc('What to show in place of the selected text after extracting it.')
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
          [TextAfterExtractionMode.LinkToNewFile]: 'Link to new file',
          [TextAfterExtractionMode.EmbedNewFile]: 'Embed new file',
          [TextAfterExtractionMode.None]: 'None'
          /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
        });
        this.bind(dropdown, 'textAfterExtractionMode');
      });

    new SettingEx(this.containerEl)
      .setName('Template')
      .setDesc(createFragment((f) => {
        f.appendText('Template to use when merging notes.');
        f.createEl('br');
        f.appendText('Available variables: ');
        f.createEl('br');
        f.appendText('- ');
        appendCodeBlock(f, '{{content}}');
        f.createEl('br');
        f.appendText('- ');
        appendCodeBlock(f, '{{fromTitle}}');
        f.createEl('br');
        f.appendText('- ');
        appendCodeBlock(f, '{{fromPath}}');
        f.createEl('br');
        f.appendText('- ');
        appendCodeBlock(f, '{{newTitle}}');
        f.createEl('br');
        f.appendText('- ');
        appendCodeBlock(f, '{{newPath}}');
        f.createEl('br');
        f.appendText('- ');
        appendCodeBlock(f, '{{date:FORMAT}}');
        f.appendText(', e.g. ');
        appendCodeBlock(f, '{{date:YYYY-MM-DD}}');
      }))
      .addCodeHighlighter((codeHighlighter) => {
        codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
        this.bind(codeHighlighter, 'template');
      });

    new SettingEx(this.containerEl)
      .setName('Should show console debug messages')
      .setDesc('Whether to show console debug messages.')
      .addToggle((toggle) => {
        const debugController = getDebugController();
        const isEnabled = debugController.get().includes(this.plugin.manifest.id);
        toggle.setValue(isEnabled);
        toggle.onChange((value) => {
          if (value) {
            debugController.enable(this.plugin.manifest.id);
          } else {
            debugController.disable(this.plugin.manifest.id);
          }
        });
      });

    new SettingEx(this.containerEl)
      .setName('Include paths')
      .setDesc(createFragment((f) => {
        f.appendText('In merge/split dialog include notes from the following paths');
        f.createEl('br');
        f.appendText('Insert each path on a new line');
        f.createEl('br');
        f.appendText('You can use path string or ');
        appendCodeBlock(f, '/regular expression/');
        f.createEl('br');
        f.appendText('If the setting is empty, all notes are included');
      }))
      .addMultipleText((multipleText) => {
        this.bind(multipleText, 'includePaths');
      });

    new SettingEx(this.containerEl)
      .setName('Exclude paths')
      .setDesc(createFragment((f) => {
        f.appendText('In merge/split dialog exclude notes from the following paths');
        f.createEl('br');
        f.appendText('Insert each path on a new line');
        f.createEl('br');
        f.appendText('You can use path string or ');
        appendCodeBlock(f, '/regular expression/');
        f.createEl('br');
        f.appendText('If the setting is empty, no notes are excluded');
      }))
      .addMultipleText((multipleText) => {
        this.bind(multipleText, 'excludePaths');
      });
  }
}
