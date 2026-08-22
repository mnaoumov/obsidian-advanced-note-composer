import type {
  SettingDefinitionItem,
  SettingDefinitionPage
} from 'obsidian';
import type { PluginSettingsTabBaseConstructorParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import { getDebugController } from 'obsidian-dev-utils/debug';
import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';
import { EMPTY } from 'obsidian-dev-utils/string';

import type { PluginSettings } from './plugin-settings.ts';

import {
  Action,
  EmptyFolderBehaviorAfterMergingFolder,
  FrontmatterMergeStrategy,
  FrontmatterTitleMode,
  MergeFolderIntoFileLocation,
  PickerRecencyOrder,
  SmartCutAndPasteCompletionFeedback,
  SplitTargetMode,
  TextAfterExtractionMode
} from './plugin-settings.ts';
import { TOKENIZED_STRING_LANGUAGE } from './tokenized-string-language-component.ts';

interface PluginSettingsTabConstructorParams extends PluginSettingsTabBaseConstructorParams<PluginSettings> {
  readonly pluginId: string;
}

interface PluginSettingsTabSettingPageParams {
  /**
   * The one-line summary shown under the page name on the navigable entry, which is all the user sees of
   * the page before opening it.
   */
  readonly desc: string;

  /**
   * The groups or rows the page holds.
   */
  readonly items: SettingDefinitionItem[];

  /**
   * The page name, shown both on the entry and as the page title.
   */
  readonly name: string;
}

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  private readonly pluginId: string;

  public constructor(params: PluginSettingsTabConstructorParams) {
    super(params);
    this.pluginId = params.pluginId;
  }

  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingGroupEx({
        heading: 'Common',
        items: [
          this.settingEx({
            desc: 'Default setting for whether to allow only current folder for destination file selector. Can be changed in the merge/split modal dialog.',
            name: 'Should allow only current folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAllowOnlyCurrentFolderByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to show console debug messages.',
            name: 'Should show console debug messages',
            render: (setting) => {
              setting.addToggle((toggle) => {
                const debugController = getDebugController();
                const isEnabled = debugController.get().includes(this.pluginId);
                toggle.setValue(isEnabled);
                toggle.onChange((value) => {
                  if (value) {
                    debugController.enable(this.pluginId);
                  } else {
                    debugController.disable(this.pluginId);
                  }
                });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Merge/split/extract strategies',
        items: [
          this.settingEx({
            desc: 'Default setting for whether to fix footnotes. Can be changed in the merge/split modal dialog.',
            name: 'Should fix footnotes',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldFixFootnotesByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to merge headings. Can be changed in the merge/split modal dialog.',
            name: 'Should merge headings',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldMergeHeadingsByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to run ');
              f.createEl('a', { href: 'https://silentvoid13.github.io/Templater/', text: 'Templater' });
              f.appendText(' on the destination file after merging/splitting.');
            }),
            name: 'Should run templater on destination file',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldRunTemplaterOnDestinationFile', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingPage({
        desc: 'Merging pours content into a destination and removes what it came from. Merging a file pours the note you started from into the note you pick, then deletes it; merging a folder pours the folder\'s notes into a single new note. The destination is always the one that survives.',
        items: [
          this.settingGroupEx({
            heading: 'All merges',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Template to use when merging notes. Applies to every merge command, including each note a folder merge pours into its destination.');
                  f.createEl('br');
                  addAvailableTokens(f);
                }),
                name: 'Merge template',
                render: (setting) => {
                  setting.addCodeHighlighter((codeHighlighter) => {
                    codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                    this.bind({
                      propertyName: 'mergeTemplate',
                      shouldResetSettingWhenComponentIsEmpty: true,
                      shouldShowPlaceholderForDefaultValues: false,
                      valueComponent: codeHighlighter
                    });
                  });
                }
              }),
              this.settingEx({
                desc: 'Whether to show a confirmation dialog before a merge runs. Applies to every merge command.',
                name: 'Should ask before merging',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldAskBeforeMerging', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText(
                    'Whether a merge also moves and merges items whose path is excluded/ignored in the plugin settings, instead of skipping them. When off (the default), excluded items are skipped and reported in a notice.'
                  );
                  f.createEl('br');
                  f.appendText('Applies to every merge command. With it on, an excluded note or folder is offered in the destination picker as well — otherwise there is no way to merge into one.');
                  f.createEl('br');
                  f.appendText('Where a merge is offered in the first place is a separate question, decided by ');
                  appendCodeBlock(f, 'Command include paths');
                  f.appendText(' / ');
                  appendCodeBlock(f, 'Command exclude paths');
                  f.appendText('. This setting never puts a command back on an excluded note or folder; it decides what happens to the excluded items a merge would touch.');
                }),
                name: 'Should always merge excluded items',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldAlwaysMergeExcludedItems', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Files whose name ends with one of these extensions are treated as attachments, not notes, so a merge never inlines their contents. Splitting and flattening a folder classify them the same way.');
                  f.createEl('br');
                  f.appendText('Insert one extension per line, written out in full including the leading dot. For example, ');
                  appendCodeBlock(f, '.excalidraw.md');
                  f.appendText(' covers ');
                  appendCodeBlock(f, 'sketch.excalidraw.md');
                  f.appendText('.');
                  f.createEl('br');
                  f.appendText('Leave empty to treat every markdown file as a note.');
                }),
                name: 'Attachment extensions',
                render: (setting) => {
                  setting.addMultipleText((multipleText) => {
                    this.bind({ propertyName: 'attachmentExtensions', valueComponent: multipleText });
                  });
                }
              })
            ]
          }),
          this.settingGroupEx({
            heading: 'Merge file',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to open the destination note once ');
                  appendCodeBlock(f, 'Merge current file with another file...');
                  f.appendText(' or ');
                  appendCodeBlock(f, 'Merge these files into one file...');
                  f.appendText(' finishes.');
                  f.createEl('br');
                  f.appendText('Neither folder merge opens the notes it merges, whatever this says — each has its own setting for what it opens at the end.');
                }),
                name: 'Should open note after merge',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldOpenNoteAfterMerge', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('When ');
                  appendCodeBlock(f, 'Merge current file with another file...');
                  f.appendText(' merges a note away, whether the attachments that note owns follow into the destination note\'s attachment folder.');
                  f.createEl('br');
                  f.appendText('The destination honors your vault\'s attachment settings, including ');
                  /**
                  HACK: see the TSDoc for {@link EMPTY} for motivation.
                  */
                  f.createEl('a', { href: 'https://github.com/mnaoumov/obsidian-custom-attachment-location', text: `${EMPTY}Custom Attachment Location` });
                  f.appendText(' when it is installed.');
                  f.createEl('br');
                  f.appendText(
                    'An attachment moves when the merged note references it and no other note does, or when it sits in an attachment folder belonging to that note alone. A shared attachment stays where it is.'
                  );
                  f.createEl('br');
                  f.appendText('Also applies to ');
                  appendCodeBlock(f, 'Merge these files into one file...');
                  f.appendText('.');
                }),
                name: 'Should move attachments when merging a file',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldMoveAttachmentsWhenMergingFile', valueComponent: toggle });
                  });
                }
              })
            ]
          }),
          this.settingGroupEx({
            heading: 'Merge folder contents into a single file',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('The name to give the note created by ');
                  appendCodeBlock(f, 'Merge folder contents into a single file...');
                  f.appendText('.');
                  f.createEl('br');
                  f.appendText('Leave empty to name it after the merged folder, e.g. ');
                  appendCodeBlock(f, 'Docs.md');
                  f.appendText(' for the folder ');
                  appendCodeBlock(f, 'Docs');
                  f.appendText('. The note is always created next to the folder, and a colliding name is de-duplicated.');
                  f.createEl('br');
                  f.appendText('Available tokens:');
                  f.createEl('br');
                  f.appendText('- ');
                  appendCodeBlock(f, '{{folderName}}');
                  f.appendText(' / ');
                  appendCodeBlock(f, '{{folderPath}}');
                  f.appendText(' - the merged folder\'s name / path.');
                  f.createEl('br');
                  f.appendText('- ');
                  appendCodeBlock(f, '{{parentFolder}}');
                  f.appendText(' - the merged folder\'s parent folder name.');
                  f.createEl('br');
                  f.appendText('- ');
                  appendCodeBlock(f, '{{date:FORMAT}}');
                  f.appendText(', e.g. ');
                  appendCodeBlock(f, '{{date:YYYY-MM-DD}}');
                }),
                name: 'Merge folder into file note name',
                render: (setting) => {
                  setting.addCodeHighlighter((codeHighlighter) => {
                    codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                    this.bind({ propertyName: 'mergeFolderIntoFileNoteNameTemplate', valueComponent: codeHighlighter });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Where the merged note is created.');
                  f.createEl('br');
                  f.appendText('- ');
                  appendCodeBlock(f, 'Beside the folder');
                  f.appendText(' - in the merged folder\'s own parent, next to the folder itself.');
                  f.createEl('br');
                  f.appendText('- ');
                  appendCodeBlock(f, 'Inside the folder');
                  f.appendText(' - in the merged folder itself, so the folder is left holding only the merged note.');
                  f.createEl('br');
                  f.appendText('- ');
                  appendCodeBlock(f, 'Default location for new notes');
                  f.appendText(' - wherever Obsidian would put a new note, per its own setting.');
                  f.createEl('br');
                  f.appendText('A colliding name is de-duplicated in every case.');
                  f.createEl('br');
                  f.appendText(
                    'Note that with '
                  );
                  appendCodeBlock(f, 'Inside the folder');
                  f.appendText(
                    ' the merged folder is no longer empty afterwards, so it is not removed even when '
                  );
                  appendCodeBlock(f, 'Empty folders after merging a folder');
                  f.appendText(' would otherwise delete it. Its emptied sub-folders are still cleaned up.');
                }),
                name: 'Merge folder into file location',
                render: (setting) => {
                  setting.addDropdown((dropdown) => {
                    dropdown.addOptions({
                      /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                      [MergeFolderIntoFileLocation.BesideFolder]: 'Beside the folder',
                      [MergeFolderIntoFileLocation.InsideFolder]: 'Inside the folder',
                      [MergeFolderIntoFileLocation.DefaultNewNoteLocation]: 'Default location for new notes'
                      /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                    });
                    this.bind({ propertyName: 'mergeFolderIntoFileLocation', valueComponent: dropdown });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('When ');
                  appendCodeBlock(f, 'Merge folder contents into a single file...');
                  f.appendText(' pulls in notes from sub-folders, whether each sub-folder becomes a heading in the merged note.');
                  f.createEl('br');
                  f.appendText('The heading level is the sub-folder\'s depth below the merged folder: a direct sub-folder becomes ');
                  appendCodeBlock(f, '# Name');
                  f.appendText(', its own child ');
                  appendCodeBlock(f, '## Name');
                  f.appendText(', and so on. Notes directly inside the merged folder get no heading.');
                  f.createEl('br');
                  f.appendText(
                    'Every sub-folder is headed, including a completely empty one, so the merged outline mirrors the whole tree. Two note-less cases are left out instead: a folder holding only attachments, and a folder whose notes are all excluded - nothing of either was merged, so neither gets a heading.'
                  );
                  f.createEl('br');
                  f.appendText('Each merged note\'s own headings are demoted to match, so the merged outline stays well-formed. This is the exact opposite of ');
                  appendCodeBlock(f, 'Split note by headings recursively...');
                  f.appendText(', which turns a heading hierarchy into a folder tree.');
                  f.createEl('br');
                  f.appendText('Markdown defines only six heading levels. A folder deeper than six still gets its full level, e.g. ');
                  appendCodeBlock(f, '####### Name');
                  f.appendText(', which Obsidian shows as plain text rather than a heading — the depth stays readable, whereas stopping at ');
                  appendCodeBlock(f, '######');
                  f.appendText(' made a folder and its own descendants indistinguishable.');
                }),
                name: 'Should convert folders to headings when merging a folder',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldConvertFoldersToHeadingsWhenMergingFolder', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('When ');
                  appendCodeBlock(f, 'Merge folder contents into a single file...');
                  f.appendText(' merges the folder\'s notes away, whether their attachments follow into the merged note\'s attachment folder.');
                  f.createEl('br');
                  f.appendText('The destination honors your vault\'s attachment settings, including ');
                  /**
                  HACK: see the TSDoc for {@link EMPTY} for motivation.
                  */
                  f.createEl('a', { href: 'https://github.com/mnaoumov/obsidian-custom-attachment-location', text: `${EMPTY}Custom Attachment Location` });
                  f.appendText(' when it is installed.');
                  f.createEl('br');
                  f.appendText('An attachment moves when one of the merged notes references it, or when it already sits where that note\'s attachments belong.');
                  f.createEl('br');
                  f.appendText('When disabled, attachments stay where they are, which also keeps their folders from being emptied.');
                }),
                name: 'Should move attachments when merging a folder',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldMoveAttachmentsWhenMergingFolder', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('What happens to the folders left empty once ');
                  appendCodeBlock(f, 'Merge folder contents into a single file...');
                  f.appendText(' has merged their notes away.');
                  f.createEl('br');
                  appendCodeBlock(f, 'Delete');
                  f.appendText(' - remove the merged folder and each sub-folder that ended up empty. A folder still holding files is always kept.');
                  f.createEl('br');
                  appendCodeBlock(f, 'Delete sub-folders only');
                  f.appendText(' - keep the merged folder itself, even once it is empty, and remove every emptied folder under it, however deep.');
                  f.createEl('br');
                  appendCodeBlock(f, 'Delete with empty parents');
                  f.appendText(' - the same as ');
                  appendCodeBlock(f, 'Delete');
                  f.appendText(', and also remove any parent folder the deletion leaves empty.');
                  f.createEl('br');
                  appendCodeBlock(f, 'Keep');
                  f.appendText(' - leave every folder in place.');
                  f.createEl('br');
                  f.appendText('Folders are removed after the merge is committed, so a cancelled merge never deletes anything.');
                }),
                name: 'Empty folders after merging a folder',
                render: (setting) => {
                  setting.addDropdown((dropdown) => {
                    dropdown.addOptions({
                      [EmptyFolderBehaviorAfterMergingFolder.Delete]: 'Delete',
                      [EmptyFolderBehaviorAfterMergingFolder.DeleteSubFoldersOnly]: 'Delete sub-folders only',
                      [EmptyFolderBehaviorAfterMergingFolder.DeleteWithEmptyParents]: 'Delete with empty parents',
                      [EmptyFolderBehaviorAfterMergingFolder.Keep]: 'Keep'
                    });
                    this.bind({ propertyName: 'emptyFolderBehaviorAfterMergingFolder', valueComponent: dropdown });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to open the merged note once ');
                  appendCodeBlock(f, 'Merge folder contents into a single file...');
                  f.appendText(' finishes.');
                  f.createEl('br');
                  f.appendText('The note is opened once, at the very end. The merged notes themselves are never opened, whatever ');
                  appendCodeBlock(f, 'Should open note after merge');
                  f.appendText(' says.');
                }),
                name: 'Should open the merged note after merging folder contents into a single file',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldOpenNoteAfterMergingFolderIntoFile', valueComponent: toggle });
                  });
                }
              })
            ]
          }),
          this.settingGroupEx({
            heading: 'Merge current folder with another folder',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether the folder picker of ');
                  appendCodeBlock(f, 'Merge current folder with another folder...');
                  f.appendText(' offers the merged folder\'s own sub-folders as destinations, by default. Can be changed in the picker itself.');
                }),
                name: 'Should include child folders when merging folders',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldIncludeChildFoldersWhenMergingByDefault', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether the folder picker of ');
                  appendCodeBlock(f, 'Merge current folder with another folder...');
                  f.appendText(' offers the merged folder\'s own parent folders as destinations, by default. Can be changed in the picker itself.');
                }),
                name: 'Should include parent folders when merging folders',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldIncludeParentFoldersWhenMergingByDefault', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to open the first note of the destination folder once ');
                  appendCodeBlock(f, 'Merge current folder with another folder...');
                  f.appendText(' finishes.');
                  f.createEl('br');
                  f.appendText(
                    'The first note is the one the file explorer shows first: the destination folder\'s own notes, ordered naturally, and only if it holds none, the first note of its first sub-folder. Notes that were already there count too. Nothing is opened if the destination holds no note at all.'
                  );
                }),
                name: 'Should open the first note after merging folders',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldOpenFirstNoteAfterMergingFolder', valueComponent: toggle });
                  });
                }
              })
            ]
          })
        ],
        name: 'Merge'
      }),
      this.settingPage({
        desc: 'Splitting and extracting take part of a note out into another note, leaving a link, an embed, or nothing behind.',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The name to give the new note inside the folder created by ');
              appendCodeBlock(f, 'Should split into folder');
              f.appendText('. It has no effect while that setting is off.');
              f.createEl('br');
              f.appendText('Leave empty to name the note after its folder, e.g. ');
              appendCodeBlock(f, '<folder>/<note>/<note>.md');
              f.appendText('. Set it to ');
              appendCodeBlock(f, 'Overview');
              f.appendText(' to get ');
              appendCodeBlock(f, '<folder>/<note>/Overview.md');
              f.appendText(' for every split instead.');
              f.createEl('br');
              f.appendText('The name the note would have had is kept as an alias and/or a frontmatter title, as configured by ');
              appendCodeBlock(f, 'Should add invalid title to note alias');
              f.appendText(' and ');
              appendCodeBlock(f, 'Frontmatter title mode');
              f.appendText(', so links to it keep resolving.');
              f.createEl('br');
              f.appendText('Tokens are resolved against the new note before it is moved, so ');
              appendCodeBlock(f, '{{newTitle}}');
              f.appendText(' is the folder name, and ');
              appendCodeBlock(f, '{{parentFolder}}');
              f.appendText(' is still the folder ABOVE the one being created — the folder tokens below name the new folder itself.');
              f.createEl('br');
              addAvailableTokens(f, false);
            }),
            name: 'Split into folder note name',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'splitIntoFolderNoteNameTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Template to use when splitting notes into a new file.');
              f.createEl('br');
              f.appendText('Leave empty to reuse ');
              appendCodeBlock(f, 'Merge template');
              f.appendText(' setting.');
              f.createEl('br');
              addAvailableTokens(f);
            }),
            name: 'Split template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'splitTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to ask before splitting notes.',
            name: 'Should ask before splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeSplitting', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to open the target note after splitting.');
              f.createEl('br');
              f.appendText('If enabled, the target note will be opened after splitting.');
              f.createEl('br');
              f.appendText('If disabled, the source note will stay opened after splitting.');
            }),
            name: 'Should open target note after split',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldOpenTargetNoteAfterSplit', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When a split or extract creates a new note, put it inside a brand-new folder named after the note, so the note lands at ');
              appendCodeBlock(f, '<folder>/<note>/<note>.md');
              f.appendText(' instead of ');
              appendCodeBlock(f, '<folder>/<note>.md');
              f.appendText('.');
              f.createEl('br');
              f.appendText('The folder name is de-duplicated if one already exists. Splitting or extracting into an existing note is unaffected.');
            }),
            name: 'Should split into folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSplitIntoFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether heading-driven splits run immediately, with no target picker and no confirmation.');
              f.createEl('br');
              f.appendText('This covers ');
              appendCodeBlock(f, 'Split note by headings - H1');
              f.appendText('…');
              appendCodeBlock(f, 'H6');
              f.appendText(', their ');
              appendCodeBlock(f, 'content');
              f.appendText(' variants, and ');
              appendCodeBlock(f, 'Extract this heading...');
              f.appendText('. Each new note is named after its heading.');
              f.createEl('br');
              f.appendText('Combine with ');
              appendCodeBlock(f, 'Should split into folder');
              f.appendText(' to put every heading into its own folder named after it.');
              f.createEl('br');
              f.appendText('When disabled, these commands keep asking, as configured by ');
              appendCodeBlock(f, 'Should ask before splitting');
              f.appendText('.');
            }),
            name: 'Should split headings automatically',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSplitHeadingsAutomatically', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether ');
              appendCodeBlock(f, 'Split note by headings recursively...');
              f.appendText(' creates its notes in Obsidian\'s ');
              appendCodeBlock(f, 'Default location for new notes');
              f.appendText(' instead of beside the note being split. It affects no other command.');
              f.createEl('br');
              f.appendText('Only the top of the produced tree moves there: a sub-heading\'s note still lands inside its parent\'s folder, so ');
              appendCodeBlock(f, '# A');
              f.appendText(' / ');
              appendCodeBlock(f, '## B');
              f.appendText(' yields ');
              appendCodeBlock(f, '<default folder>/A/A.md');
              f.appendText(' and ');
              appendCodeBlock(f, '<default folder>/A/B/B.md');
              f.appendText('. The folder tree is kept — redirecting every note would flatten it away.');
              f.createEl('br');
              f.appendText('The note being split is not moved; it stays where it is and links down into the new tree.');
              f.createEl('br');
              f.appendText('This has no effect while Obsidian\'s own setting is ');
              appendCodeBlock(f, 'Same folder as current file');
              f.appendText(', which resolves to the behavior this setting replaces.');
            }),
            name: 'Should split recursively into the default new note folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSplitRecursivelyIntoDefaultNewNoteFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'What to show in place of the selected text after extracting it.',
            name: 'Text after extraction',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [TextAfterExtractionMode.LinkToNewFile]: 'Link to new file',
                  [TextAfterExtractionMode.EmbedNewFile]: 'Embed new file',
                  [TextAfterExtractionMode.None]: 'None'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'textAfterExtractionMode', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to apply the ');
              appendCodeBlock(f, 'Text after extraction');
              f.appendText(' setting when moving a selection within the same note.');
              f.createEl('br');
              f.appendText('When disabled, moving within the same note leaves nothing in place of the moved text, since a self-link would be meaningless.');
              f.createEl('br');
              f.appendText('This can still be overridden per move in ');
              appendCodeBlock(f, 'Move marked selection here (advanced)...');
              f.appendText('.');
            }),
            name: 'Apply text after extraction to the same file',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldApplyTextAfterExtractionToSameFile', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default setting for whether to allow split into unresolved path. Can be changed in the split modal dialog.');
              f.createEl('br');
              f.appendText('Unresolved path comes from links like ');
              appendCodeBlock(f, '[[non-existing note]]');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Some plugins also call them as ');
              appendCodeBlock(f, 'broken links');
              f.appendText('.');
            }),
            name: 'Should allow split into unresolved path',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAllowSplitIntoUnresolvedPathByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the note you are splitting from is offered in the split/extract picker.');
              f.createEl('br');
              f.appendText('Picking it extracts the selection to that same note: ');
              appendCodeBlock(f, 'Enter');
              f.appendText(' puts it at the bottom, ');
              appendCodeBlock(f, 'Shift+Enter');
              f.appendText(' at the top.');
              f.createEl('br');
              f.appendText('Turn this off to only ever pick another note. Note that ');
              appendCodeBlock(f, 'Switch to smart cut & paste');
              f.appendText(' is not a replacement: it moves the selection to the cursor, not to the top or bottom of the note.');
              f.createEl('br');
              f.appendText('Extracting into the note you are already in is a merge into an existing note, so the picker offers it while its switch says ');
              appendCodeBlock(f, 'Merge');
              f.appendText(' — see ');
              appendCodeBlock(f, 'Default split target mode');
              f.appendText(' below.');
            }),
            name: 'Should offer the current note when splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldOfferCurrentNoteWhenSplitting', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether you are asked WHERE to put a new note once you have named it, instead of the destination falling out of ');
              appendCodeBlock(f, 'Should allow only current folder');
              f.appendText(', a path typed into the name box, or Obsidian\'s ');
              appendCodeBlock(f, 'Default location for new notes');
              f.appendText('.');
              f.createEl('br');
              f.appendText('The folder picker opens after the name is confirmed and before the confirmation dialog. Dismissing it takes you back to the name you typed, not out of the operation.');
              f.createEl('br');
              f.appendText('Only applies while a note is being CREATED: the picker has to have opened at all, and its switch has to say ');
              appendCodeBlock(f, 'Create');
              f.appendText('. Heading-driven splits that run without the picker are unaffected, and so is every ');
              appendCodeBlock(f, 'Merge');
              f.appendText(', which chooses a note that already exists.');
              f.createEl('br');
              f.appendText('Picking an existing note in the list already puts the new note in THAT note\'s folder, with no extra prompt.');
            }),
            name: 'Should ask for the target folder when splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskForTargetFolderWhenSplitting', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Which mode the split/extract picker opens in.');
              f.createEl('br');
              appendCodeBlock(f, 'Create');
              f.appendText(' creates a new note from the name you type, at the path you type or complete with ');
              appendCodeBlock(f, 'Tab');
              f.appendText('.');
              f.createEl('br');
              appendCodeBlock(f, 'Merge');
              f.appendText(' merges the extracted content into the existing note you pick, and offers nothing that would create one.');
              f.createEl('br');
              f.appendText('The switch above the picker flips it for a single run, as does ');
              appendCodeBlock(f, 'Alt+M');
              f.appendText('; ');
              appendCodeBlock(f, 'Mod+Enter');
              f.appendText(' moves it to ');
              appendCodeBlock(f, 'Create');
              f.appendText(' and chooses.');
            }),
            name: 'Default split target mode',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  [SplitTargetMode.Create]: 'Create',
                  [SplitTargetMode.Merge]: 'Merge'
                });
                this.bind({ propertyName: 'defaultSplitTargetMode', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether choosing a target in the picker saves the mode it was in back to ');
              appendCodeBlock(f, 'Default split target mode');
              f.appendText(', so the next split/extract opens where the last one left off.');
              f.createEl('br');
              f.appendText('Flows that show no switch never save anything: a heading-driven split that skips the picker, and ');
              appendCodeBlock(f, 'Create empty note at cursor...');
              f.appendText(', which has nothing to merge.');
            }),
            name: 'Should remember the last split target mode',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldRememberLastSplitTargetMode', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Template to use when splitting notes to existing file.',
            name: 'Split to existing file template',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  [Action.Merge]: 'Merge',
                  [Action.Split]: 'Split'
                });
                this.bind({ propertyName: 'splitToExistingFileTemplate', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to keep headings when splitting content.',
            name: 'Should keep headings when splitting content',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldKeepHeadingsWhenSplittingContent', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the attachments the extracted text references follow it into the new note\'s attachment folder.');
              f.createEl('br');
              f.appendText('The destination honors your vault\'s attachment settings, including ');
              /**
              HACK: see the TSDoc for {@link EMPTY} for motivation.
              */
              f.createEl('a', { href: 'https://github.com/mnaoumov/obsidian-custom-attachment-location', text: `${EMPTY}Custom Attachment Location` });
              f.appendText(' when it is installed.');
              f.createEl('br');
              f.appendText(
                'An attachment moves only when the extracted text is the only thing referencing it. One referenced by the text left behind, or by any other note, stays where it is.'
              );
              f.createEl('br');
              f.appendText('Applies to every split and extract command, including ');
              appendCodeBlock(f, 'Split heading recursively...');
              f.appendText(', ');
              appendCodeBlock(f, 'Split note by headings recursively...');
              f.appendText(' — where each created note gets its own attachment folder — and the smart cut & paste moves into another note.');
            }),
            name: 'Should move attachments when splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldMoveAttachmentsWhenSplitting', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Once the extract lands, hand the destination note to ');
              /**
              HACK: see the TSDoc for {@link EMPTY} for motivation.
              */
              f.createEl('a', { href: 'https://github.com/mnaoumov/obsidian-custom-attachment-location', text: `${EMPTY}Custom Attachment Location` });
              f.appendText(' so it collects that note\'s attachments, as if you had run its ');
              appendCodeBlock(f, 'Collect attachments in current note');
              f.appendText(' command yourself.');
              f.createEl('br');
              f.appendText(
                'Useful because the setting above stops short: it moves an attachment only when the extracted text is the only thing referencing it. Where a SHARED attachment belongs is a question this plugin cannot answer, and that one can.'
              );
              f.createEl('br');
              f.appendText('Does nothing when that plugin is not installed or is disabled.');
            }),
            name: 'Should collect attachments with Custom Attachment Location after splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit', valueComponent: toggle });
              });
            }
          })
        ],
        name: 'Split/extract'
      }),
      this.settingPage({
        desc: 'Swapping exchanges two files or two folders, each taking the other\'s place.',
        // Issue #241 removed the `Swap file` / `Swap folders` subheadings issue #226 had given this page.
        // `Should ask before swapping` applies to both kinds of swap, so it belonged to neither, and
        // `Swap file` held nothing else; the three folder rows name their own target type, so the headings
        // Carried nothing their names lack. The `Merge` page keeps its subheadings (issue #240) — there
        // Each row genuinely belongs to exactly one command.
        items: [
          this.settingEx({
            desc: 'Whether to show a confirmation dialog before swapping files or folders.',
            name: 'Should ask before swapping',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeSwapping', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to include child folders into the swap folder modal. Can be changed in the swap folders modal dialog.',
            name: 'Should include child folders when swapping folders',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeChildFoldersWhenSwappingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to include parent folders into the swap folder modal. Can be changed in the swap folders modal dialog.',
            name: 'Should include parent folders when swapping folders',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeParentFoldersWhenSwappingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default setting for whether to swap entire folder structure. Can be changed in the swap folders modal dialog.');
              f.createEl('br');
              f.appendText('If enabled, the entire folder structure will be swapped.');
              f.createEl('br');
              f.appendText('If disabled, only the top-level files of the folders will be swapped.');
            }),
            name: 'Should swap entire folder structure',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSwapEntireFolderStructureByDefault', valueComponent: toggle });
              });
            }
          })
        ],
        name: 'Swap'
      }),
      this.settingPage({
        desc: 'Mark a selection in one note, then move it to the cursor, the top, or the bottom of another note.',
        items: [
          // Issue #243 moved this row off the `Split/extract` page: no split or extract ever reads it —
          // Both of the split modal's uses are its `switch to smart cut` paths, which mark the selection
          // Through the same `markSelectionToMove()` helper the two mark commands use. It sits FLAT on the
          // Page, above the groups, because it governs the mark itself rather than any one notice or
          // Move direction.
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When you run ');
              appendCodeBlock(f, 'Mark selection to move');
              f.appendText(' or ');
              appendCodeBlock(f, 'Mark heading to move');
              f.appendText(
                ', whether to lock every note (blocking edits) until the move is completed or cancelled, so you must finish the move before editing anything.'
              );
              f.createEl('br');
              f.appendText('When disabled, only the source note is locked.');
              f.createEl('br');
              f.appendText('Switching a split over to smart cut & paste — from the picker or from the confirmation dialog — marks the selection the same way, so it is locked the same way too.');
            }),
            name: 'Should lock all notes when marking selection',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldLockAllNotesWhenMarkingSelection', valueComponent: toggle });
              });
            }
          }),
          this.settingGroupEx({
            heading: 'Notice',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to show the notice after you run ');
                  appendCodeBlock(f, 'Mark selection to move');
                  f.appendText('. The notice reminds you a selection is marked and offers buttons to move or cancel it.');
                  f.createEl('br');
                  f.appendText('When disabled, no notice is shown; you drive the move and cancel purely through the commands (and their hotkeys).');
                }),
                name: 'Should show smart cut & paste notice',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldShowSmartCutNotice', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to show the ');
                  appendCodeBlock(f, 'Split heading recursively...');
                  f.appendText(' button in the smart cut & paste notice.');
                  f.createEl('br');
                  f.appendText('Shown only while a heading is marked via ');
                  appendCodeBlock(f, 'Mark heading to move');
                  f.appendText(' - a marked selection has no heading to split. Clicking it cancels the mark, since the split rewrites the note the mark keeps locked.');
                  f.createEl('br');
                  f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
                }),
                name: 'Should show split heading recursively button',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldShowSplitHeadingRecursivelyButton', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to show the ');
                  appendCodeBlock(f, 'Reorder headings...');
                  f.appendText(' button in the smart cut & paste notice.');
                  f.createEl('br');
                  f.appendText('Shown only while a heading is marked via ');
                  appendCodeBlock(f, 'Mark heading to move');
                  f.appendText(', and only when the marked note has headings that can be reordered. Clicking it cancels the mark, since the reorder rewrites the note the mark keeps locked.');
                  f.createEl('br');
                  f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
                }),
                name: 'Should show reorder headings button',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldShowReorderHeadingsButton', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('How a finished smart cut & paste move tells you where the marked selection landed.');
                  f.createEl('br');
                  appendCodeBlock(f, 'Select moved content');
                  f.appendText(' - select the moved text in the target note.');
                  f.createEl('br');
                  appendCodeBlock(f, 'Notice');
                  f.appendText(' - put the cursor on the moved text without selecting it, and show a notice instead.');
                  f.createEl('br');
                  appendCodeBlock(f, 'Select moved content and notice');
                  f.appendText(' - do both.');
                  f.createEl('br');
                  f.appendText(
                    'A selection in the target note looks exactly like the highlight on a selection that is still marked and waiting to be moved, so the two states are hard to tell apart — especially while the notes are locked. The notice modes remove that ambiguity; the cursor still travels to the moved text either way.'
                  );
                  f.createEl('br');
                  f.appendText('This applies only when the move jumps at all: with the jump turned off for the direction, neither the cursor nor a notice moves.');
                }),
                name: 'Smart cut & paste completion feedback',
                render: (setting) => {
                  setting.addDropdown((dropdown) => {
                    dropdown.addOptions({
                      /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                      [SmartCutAndPasteCompletionFeedback.SelectMovedContent]: 'Select moved content',
                      [SmartCutAndPasteCompletionFeedback.Notice]: 'Notice',
                      [SmartCutAndPasteCompletionFeedback.SelectMovedContentAndNotice]: 'Select moved content and notice'
                      /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                    });
                    this.bind({ propertyName: 'smartCutAndPasteCompletionFeedback', valueComponent: dropdown });
                  });
                }
              })
            ]
          }),
          this.settingGroupEx({
            heading: 'At cursor',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Template to use when pasting a marked selection at the cursor (');
                  appendCodeBlock(f, 'Move marked selection here');
                  f.appendText(' and ');
                  appendCodeBlock(f, 'at cursor');
                  f.appendText(').');
                  f.createEl('br');
                  f.appendText('It is also used by ');
                  appendCodeBlock(f, 'to top of file');
                  f.appendText(' and ');
                  appendCodeBlock(f, 'to bottom of file');
                  f.appendText(', unless the direction has its own template below.');
                  f.createEl('br');
                  f.appendText('Leave empty to reuse ');
                  appendCodeBlock(f, 'Split template');
                  f.appendText(' setting.');
                  f.createEl('br');
                  addAvailableTokens(f);
                }),
                name: 'Smart cut & paste template',
                render: (setting) => {
                  setting.addCodeHighlighter((codeHighlighter) => {
                    codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                    this.bind({ propertyName: 'smartCutAndPasteTemplate', valueComponent: codeHighlighter });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to show the ');
                  appendCodeBlock(f, 'Move marked selection at cursor');
                  f.appendText(' button in the smart cut & paste notice.');
                  f.createEl('br');
                  f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
                }),
                /**
                HACK: see the TSDoc for {@link EMPTY} for motivation.
                */
                name: `${EMPTY}Should show move at cursor button`,
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldShowMoveAtCursorButton', valueComponent: toggle });
                  });
                }
              })
            ]
          }),
          this.settingGroupEx({
            heading: 'To top of file',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Template to use when pasting a marked selection via ');
                  appendCodeBlock(f, 'Move marked selection to top of file');
                  f.appendText('.');
                  f.createEl('br');
                  f.appendText('Leave empty to reuse ');
                  appendCodeBlock(f, 'Smart cut & paste template');
                  f.appendText(' setting.');
                  f.createEl('br');
                  addAvailableTokens(f);
                }),
                name: 'Smart cut & paste template (to top of file)',
                render: (setting) => {
                  setting.addCodeHighlighter((codeHighlighter) => {
                    codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                    this.bind({ propertyName: 'smartCutAndPasteToTopTemplate', valueComponent: codeHighlighter });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to show the ');
                  appendCodeBlock(f, 'Move marked selection to top of file');
                  f.appendText(' button in the smart cut & paste notice.');
                  f.createEl('br');
                  f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
                }),
                name: 'Should show move to top of file button',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldShowMoveToTopButton', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether the cursor follows the marked selection after ');
                  appendCodeBlock(f, 'Move marked selection to top of file');
                  f.appendText(', landing on the moved text where it ends up. How that landing is shown is up to ');
                  appendCodeBlock(f, 'Smart cut & paste completion feedback');
                  f.appendText(' above.');
                  f.createEl('br');
                  f.appendText('When disabled, the cursor stays where the selection was cut from, so you can move text out of the way without losing your place.');
                }),
                name: 'Should jump to content moved to top of file',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldJumpToMovedContentToTop', valueComponent: toggle });
                  });
                }
              })
            ]
          }),
          this.settingGroupEx({
            heading: 'To bottom of file',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Template to use when pasting a marked selection via ');
                  appendCodeBlock(f, 'Move marked selection to bottom of file');
                  f.appendText('.');
                  f.createEl('br');
                  f.appendText('Leave empty to reuse ');
                  appendCodeBlock(f, 'Smart cut & paste template');
                  f.appendText(' setting.');
                  f.createEl('br');
                  addAvailableTokens(f);
                }),
                name: 'Smart cut & paste template (to bottom of file)',
                render: (setting) => {
                  setting.addCodeHighlighter((codeHighlighter) => {
                    codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                    this.bind({ propertyName: 'smartCutAndPasteToBottomTemplate', valueComponent: codeHighlighter });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether to show the ');
                  appendCodeBlock(f, 'Move marked selection to bottom of file');
                  f.appendText(' button in the smart cut & paste notice.');
                  f.createEl('br');
                  f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
                }),
                name: 'Should show move to bottom of file button',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldShowMoveToBottomButton', valueComponent: toggle });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Whether the cursor follows the marked selection after ');
                  appendCodeBlock(f, 'Move marked selection to bottom of file');
                  f.appendText(', landing on the moved text where it ends up. How that landing is shown is up to ');
                  appendCodeBlock(f, 'Smart cut & paste completion feedback');
                  f.appendText(' above.');
                  f.createEl('br');
                  f.appendText('When disabled, the cursor stays where the selection was cut from, so you can move text out of the way without losing your place.');
                  f.createEl('br');
                  f.appendText(
                    'There is no such setting for a move at the cursor: it always jumps, since inserting text at the cursor and then leaving the cursor elsewhere makes no sense.'
                  );
                }),
                name: 'Should jump to content moved to bottom of file',
                render: (setting) => {
                  setting.addToggle((toggle) => {
                    this.bind({ propertyName: 'shouldJumpToMovedContentToBottom', valueComponent: toggle });
                  });
                }
              })
            ]
          })
        ],
        name: 'Smart cut & paste'
      }),
      this.settingPage({
        desc: 'How properties are carried across when notes are merged, split, or extracted.',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default frontmatter merge strategy to use when merging notes. Can be changed in the merge/split modal dialog.');
              f.createEl('br');
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
            }),
            name: 'Frontmatter merge strategy',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [FrontmatterMergeStrategy.MergeAndPreferNewValues]: 'Merge and prefer new values',
                  [FrontmatterMergeStrategy.MergeAndPreferOriginalValues]: 'Merge and prefer original values',
                  [FrontmatterMergeStrategy.KeepOriginalFrontmatter]: 'Keep original frontmatter',
                  [FrontmatterMergeStrategy.ReplaceWithNewFrontmatter]: 'Replace with new frontmatter',
                  [FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter]: 'Preserve both original and new frontmatter'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'defaultFrontmatterMergeStrategy', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('How to handle the title property in the frontmatter.');
              f.createEl('br');
              appendCodeBlock(f, 'None');
              f.appendText(' - do not add the title property to the frontmatter.');
              f.createEl('br');
              appendCodeBlock(f, 'Use for invalid title only');
              f.appendText(' - add the title property to the frontmatter only if the title is cannot be used as a filename.');
              f.createEl('br');
              appendCodeBlock(f, 'Use always');
              f.appendText(' - add the title property to the frontmatter always.');
            }),
            name: 'Frontmatter title mode',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [FrontmatterTitleMode.None]: 'None',
                  [FrontmatterTitleMode.UseForInvalidTitleOnly]: 'Use for invalid title only',
                  [FrontmatterTitleMode.UseAlways]: 'Use always'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'frontmatterTitleMode', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When merging, if the destination note (note B) has no ');
              appendCodeBlock(f, 'title');
              f.appendText(' property, use the ');
              appendCodeBlock(f, 'title');
              f.appendText(' from the merged-in note (note A) instead of leaving it empty.');
              f.createEl('br');
              f.appendText('When the destination note already has a ');
              appendCodeBlock(f, 'title');
              f.appendText(', it is always kept.');
            }),
            name: 'Should use source title when destination has none',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldUseSourceTitleWhenTargetHasNoTitle', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to add invalid title to the note alias.',
            name: 'Should add invalid title to note aliases',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAddInvalidTitleToNoteAlias', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to include frontmatter when splitting. Can be changed in the split modal dialog.',
            name: 'Should include frontmatter when splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeFrontmatterWhenSplittingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When the extracted selection lies entirely inside the note\'s properties, extract it as ');
              f.appendText('properties: they are merged into the destination note\'s own properties through the ');
              appendCodeBlock(f, 'Frontmatter merge strategy');
              f.appendText(', instead of being pasted into its body as raw text.');
              f.createEl('br');
              f.appendText('Every property line the selection touches is taken in full, together with the property it belongs to, ');
              f.appendText('so selecting two ');
              appendCodeBlock(f, 'aliases');
              f.appendText(' values moves them across as ');
              appendCodeBlock(f, 'aliases');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Smart cut & paste moves are unaffected: they insert at the cursor you place in the note\'s body.');
            }),
            name: 'Should extract a properties selection as properties',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldExtractFrontmatterSelectionAsProperties', valueComponent: toggle });
              });
            }
          })
        ],
        name: 'Frontmatter'
      }),
      this.settingPage({
        desc: 'How a name you type becomes the file name of the note it creates.',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('How a name is rewritten before it is turned into a file name, so you can define your own replacements ');
              f.appendText('instead of relying on the single replacement string below.');
              f.createEl('br');
              f.appendText('Leave empty to use the name as it was typed.');
              f.createEl('br');
              f.appendText('Available tokens:');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, '{{rawString}}');
              f.appendText(' - the name as it was typed, before any other clean-up.');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, '{{date:FORMAT}}');
              f.appendText(' and ');
              appendCodeBlock(f, '{{time:FORMAT}}');
              f.createEl('br');
              f.appendText('With ');
              f.createEl('a', { href: 'https://silentvoid13.github.io/Templater/', text: 'Templater' });
              f.appendText(' installed, the same values are available as ');
              appendCodeBlock(f, 'TOKENS.rawString');
              f.appendText(', which is how you write a mapping:');
              f.createEl('br');
              appendCodeBlock(f, '<% TOKENS.rawString.replaceAll(": ", " - ") %>');
              f.createEl('br');
              f.appendText('turns ');
              appendCodeBlock(f, 'A: B');
              f.appendText(' into ');
              appendCodeBlock(f, 'A - B');
              f.appendText('.');
              f.createEl('br');
              f.appendText('No note has to be open for that: ');
              appendCodeBlock(f, 'tp.file');
              f.appendText(' reports on the note you have open, or on the last one you opened or edited when you have none.');
              f.createEl('br');
              f.appendText('Applies everywhere a name becomes a file name: split and extract targets, the merged note name, and ');
              appendCodeBlock(f, 'Create folder with notes...');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Characters the rewrite leaves invalid are handled by ');
              appendCodeBlock(f, 'Should replace invalid characters');
              f.appendText(' below: turn it off to have such names refused instead of replaced.');
            }),
            name: 'Name transform template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'nameTransformTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to replace invalid characters in the title.');
              f.createEl('br');
              f.appendText('If disabled, the error will be shown for invalid titles.');
            }),
            name: 'Should replace invalid characters',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({
                  onChanged: () => {
                    // Only the replacement-string row reads this value, through its `disabled` predicate.
                    this.refreshDomState();
                  },
                  propertyName: 'shouldReplaceInvalidTitleCharacters',
                  valueComponent: toggle
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('String to replace invalid characters with.');
              f.createEl('br');
              f.appendText('Leave blank to remove invalid characters.');
            }),
            disabled: () => !this.pluginSettingsComponent.settings.shouldReplaceInvalidTitleCharacters,
            name: 'Replacement string',
            render: (setting) => {
              setting.addText((text) => {
                this.bind({
                  propertyName: 'replacement',
                  shouldResetSettingWhenComponentIsEmpty: false,
                  valueComponent: text
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default setting for whether to treat title as path. Can be changed in the merge/split modal dialog.');
              f.createEl('br');
              f.appendText('If enabled, the title ');
              appendCodeBlock(f, 'foo/bar/baz');
              f.appendText(' will be treated as ');
              appendCodeBlock(f, 'foo/bar/baz.md');
              f.appendText(' path.');
              f.createEl('br');
              f.appendText('If disabled, the title ');
              appendCodeBlock(f, 'foo/bar/baz');
              f.appendText(' will be treated as ');
              appendCodeBlock(f, 'foo_bar_baz.md');
              f.appendText(' path.');
              f.createEl('br');
              f.appendText('When using ');
              appendCodeBlock(f, 'Split note by headings/content');
              f.appendText(' commands, the setting will be treated as disabled.');
            }),
            name: 'Should treat title as path',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldTreatTitleAsPathByDefault', valueComponent: toggle });
              });
            }
          })
        ],
        name: 'Title'
      }),
      this.settingPage({
        desc: 'Which paths this plugin works on, and where its commands are offered at all.',
        items: [
          this.settingGroupEx({
            heading: 'Paths',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('In merge/split dialog include notes from the following paths');
                  f.createEl('br');
                  f.appendText('Insert each path on a new line');
                  f.createEl('br');
                  f.appendText('You can use path string or ');
                  appendCodeBlock(f, '/regular expression/');
                  f.createEl('br');
                  appendPathFormsDesc(f);
                  f.createEl('br');
                  f.appendText('If the setting is empty, all notes are included');
                }),
                name: 'Include paths',
                render: (setting) => {
                  setting.addMultipleText((multipleText) => {
                    this.bind({ propertyName: 'includePaths', valueComponent: multipleText });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('In merge/split dialog exclude notes from the following paths');
                  f.createEl('br');
                  f.appendText('Insert each path on a new line');
                  f.createEl('br');
                  f.appendText('You can use path string or ');
                  appendCodeBlock(f, '/regular expression/');
                  f.createEl('br');
                  appendPathFormsDesc(f);
                  f.createEl('br');
                  f.appendText('If the setting is empty, no notes are excluded');
                  f.createEl('br');
                  f.appendText(
                    'An excluded item is also never MOVED by a folder operation: a folder merge skips it, and a flatten leaves it where it is, subtree included. That is independent of the '
                  );
                  appendCodeBlock(f, 'Command include/exclude paths');
                  f.appendText(' settings below, which only decide whether the commands are offered at all');
                  f.createEl('br');
                  f.appendText('This is how to protect your attachment folder when ');
                  /**
                  HACK: see the TSDoc for {@link EMPTY} for motivation.
                  */
                  f.createEl('a', { href: 'https://github.com/mnaoumov/obsidian-custom-attachment-location', text: `${EMPTY}Custom Attachment Location` });
                  f.appendText(
                    ' decides where attachments go: it derives the folder from the note, and that cannot be reversed into "which folder is an attachment folder". Without it, only your vault\'s own '
                  );
                  appendCodeBlock(f, 'Files & Links > Default location for new attachments');
                  f.appendText(' is recognized');
                }),
                name: 'Exclude paths',
                render: (setting) => {
                  setting.addMultipleText((multipleText) => {
                    this.bind({ propertyName: 'excludePaths', valueComponent: multipleText });
                  });
                }
              })
            ]
          }),
          this.settingGroupEx({
            heading: 'Commands',
            items: [
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Offer Advanced Note Composer commands only on notes and folders from the following paths');
                  f.createEl('br');
                  f.appendText('Insert each path on a new line');
                  f.createEl('br');
                  f.appendText('You can use path string or ');
                  appendCodeBlock(f, '/regular expression/');
                  f.createEl('br');
                  appendPathFormsDesc(f);
                  f.createEl('br');
                  f.appendText('If the setting is empty, the commands are offered everywhere');
                }),
                name: 'Command include paths',
                render: (setting) => {
                  setting.addMultipleText((multipleText) => {
                    this.bind({ propertyName: 'commandIncludePaths', valueComponent: multipleText });
                  });
                }
              }),
              this.settingEx({
                desc: createFragment((f) => {
                  f.appendText('Hide Advanced Note Composer commands on notes and folders from the following paths');
                  f.createEl('br');
                  f.appendText('Insert each path on a new line');
                  f.createEl('br');
                  f.appendText('You can use path string or ');
                  appendCodeBlock(f, '/regular expression/');
                  f.createEl('br');
                  appendPathFormsDesc(f);
                  f.createEl('br');
                  f.appendText('If the setting is empty, no commands are hidden');
                  f.createEl('br');
                  f.appendText(
                    'A hidden command is gone from the command palette and from the editor, file, and folder context menus, so it cannot be triggered at all. This is a separate list from '
                  );
                  appendCodeBlock(f, 'Include/exclude paths');
                  f.appendText(
                    ' on purpose: a path excluded there is still refused as a merge/split target and never moved, but its commands stay visible and explain themselves with an "ignored in the plugin settings" notice when triggered. List it here as well to hide them instead'
                  );
                }),
                name: 'Command exclude paths',
                render: (setting) => {
                  setting.addMultipleText((multipleText) => {
                    this.bind({ propertyName: 'commandExcludePaths', valueComponent: multipleText });
                  });
                }
              })
            ]
          })
        ],
        name: 'Include/exclude'
      }),
      this.settingPage({
        desc: 'Moving a folder into another one, and flattening a folder into its parent.',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show a confirmation dialog before flattening a folder.');
              f.createEl('br');
              f.appendText('The dialog lists every child that will be moved up one level, including the de-duplicated name any colliding child will get.');
            }),
            name: 'Should ask before flattening a folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeFlattening', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to show a confirmation dialog before moving a folder into the folder picked in the suggester.',
            name: 'Should ask before moving a folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeMovingFolder', valueComponent: toggle });
              });
            }
          })
        ],
        name: 'Move/flatten folders'
      }),
      this.settingPage({
        desc: 'The folder that Create folder with notes creates, and the notes placed inside it.',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The name to give the folder created by ');
              appendCodeBlock(f, 'Create folder with notes...');
              f.appendText('.');
              f.createEl('br');
              appendCodeBlock(f, '{{index}}');
              f.appendText(' is the next number in the sequence, read from the sibling folders that already match this template. Use ');
              appendCodeBlock(f, '{{index:000}}');
              f.appendText(' to zero-pad it to the width of the mask.');
              f.createEl('br');
              f.appendText('Leave ');
              appendCodeBlock(f, '{{index}}');
              f.appendText(' out to stop numbering altogether.');
              f.createEl('br');
              addCreateFolderTokens(f, false);
            }),
            name: 'Create folder name template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'newFolderNameTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The notes to create inside the new folder.');
              f.createEl('br');
              f.appendText('Leave empty to create a single empty note named after the folder.');
              f.createEl('br');
              f.appendText('To create several notes, start each one with ');
              appendCodeBlock(f, '{{file}}');
              f.appendText(' at the beginning of its own line, followed by the note name. Everything up to the next ');
              appendCodeBlock(f, '{{file}}');
              f.appendText(' line is that note\'s content, and the first note declared is the one that gets opened. For example:');
              f.createEl('br');
              appendCodeBlock(f, '{{file}} {{safeFolderName}}.md');
              f.createEl('br');
              appendCodeBlock(f, '# {{folderName}}');
              f.createEl('br');
              f.appendText('When ');
              appendCodeBlock(f, 'Should run templater on destination file');
              f.appendText(' is on, every token is also available to Templater code as ');
              appendCodeBlock(f, '<% TOKENS.safeFolderName %>');
              f.appendText(' — as real values, so ');
              appendCodeBlock(f, '<% TOKENS.index + 1 %>');
              f.appendText(' works too. A template pulled in with ');
              appendCodeBlock(f, 'tp.file.include');
              f.appendText(' does not see them; pass what it needs through the note\'s own properties instead.');
              f.createEl('br');
              addCreateFolderTokens(f, true);
            }),
            name: 'Create folder content template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'newFolderContentTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the typed folder name is capitalized: the first letter of each word upper-cased and the rest lower-cased.');
              f.createEl('br');
              f.appendText('A word that is already entirely upper-case is left alone, so an acronym survives — ');
              appendCodeBlock(f, 'api TEST');
              f.appendText(' becomes ');
              appendCodeBlock(f, 'Api TEST');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Trimming and collapsing repeated whitespace always happen. Invalid characters are governed by ');
              appendCodeBlock(f, 'Should replace invalid title characters');
              f.appendText(' and ');
              appendCodeBlock(f, 'Replacement');
              f.appendText('.');
            }),
            name: 'Should capitalize the created folder name',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldTitleCaseCreatedFolderName', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to open the created note. With several notes declared, the first one is opened.',
            name: 'Should open note after creating folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldOpenNoteAfterCreatingFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show a confirmation dialog before creating the folder.');
              f.createEl('br');
              f.appendText('The dialog shows the normalized folder name and the notes about to be created, which is the only place the difference between what you typed and what you get is visible beforehand.');
            }),
            name: 'Should ask before creating a folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({
                  onChanged: () => {
                    // Only the two rename-button rows read this value, through their `disabled` predicates.
                    this.refreshDomState();
                  },
                  propertyName: 'shouldAskBeforeCreatingFolder',
                  valueComponent: toggle
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the confirmation dialog offers a ');
              appendCodeBlock(f, 'Rename');
              f.appendText(' button beside the folder name.');
              f.createEl('br');
              f.appendText('That name is the one you typed, rewritten by the numbering template and the title rules, so the button is where you correct what the normalization did to it.');
              f.createEl('br');
              f.appendText('Has no effect while ');
              appendCodeBlock(f, 'Should ask before creating a folder');
              f.appendText(' is off: without the dialog there is no button.');
            }),
            disabled: () => !this.pluginSettingsComponent.settings.shouldAskBeforeCreatingFolder,
            name: 'Should show rename button for the created folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowRenameButtonForCreatedFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the confirmation dialog offers a ');
              appendCodeBlock(f, 'Rename');
              f.appendText(' button beside each note under ');
              appendCodeBlock(f, 'Notes that will be created');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Turn it off when the names in ');
              appendCodeBlock(f, 'Create folder content template');
              f.appendText(' are already the names you want: the dialog still previews every note, but the previewed names are final.');
              f.createEl('br');
              f.appendText('Has no effect while ');
              appendCodeBlock(f, 'Should ask before creating a folder');
              f.appendText(' is off: without the dialog there is no button.');
            }),
            disabled: () => !this.pluginSettingsComponent.settings.shouldAskBeforeCreatingFolder,
            name: 'Should show rename button for created notes',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowRenameButtonForCreatedNotes', valueComponent: toggle });
              });
            }
          })
        ],
        name: 'Create folder with notes'
      }),
      this.settingPage({
        desc: 'Where this vault keeps the note that describes a folder, and what a rename or a reorder writes into it.',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Where this vault keeps the note that describes a folder — the only note a reorder or a rename rewrites the properties of.');
              f.createEl('br');
              appendCodeBlock(f, 'Auto');
              f.appendText(' reads the installed ');
              appendCodeBlock(f, 'Folder notes');
              f.appendText(' plugin every time, so reconfiguring that plugin needs no change here. Without it, ');
              appendCodeBlock(f, 'Auto');
              f.appendText(' means a note named after its folder, inside it.');
              f.createEl('br');
              f.appendText('That plugin\'s third option — keeping every folder note in one central folder — has no equivalent here, and ');
              appendCodeBlock(f, 'Auto');
              f.appendText(' falls back when it is set: with the notes pooled, which note belongs to a folder no longer follows from the folder\'s path.');
            }),
            name: 'Folder note location',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  [FolderNoteLocation.Auto]: 'Auto (follow the Folder notes plugin)',
                  [FolderNoteLocation.InsideFolder]: 'Inside the folder',
                  [FolderNoteLocation.None]: 'This vault has no folder notes',
                  [FolderNoteLocation.ParentFolder]: 'Beside the folder'
                });
                this.bind({
                  onChanged: () => {
                    // The name row is meaningless while the location is Auto (that plugin supplies the
                    // Name too) or None.
                    this.refreshDomState();
                  },
                  propertyName: 'folderNoteLocation',
                  valueComponent: dropdown
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('What the folder note is called.');
              f.createEl('br');
              appendCodeBlock(f, '{{folderName}}');
              f.appendText(' names it after its folder; a literal like ');
              appendCodeBlock(f, '!');
              f.appendText(' or ');
              appendCodeBlock(f, 'index');
              f.appendText(' gives every folder note the same name.');
              f.createEl('br');
              f.appendText('Has no effect while ');
              appendCodeBlock(f, 'Folder note location');
              f.appendText(' is ');
              appendCodeBlock(f, 'Auto');
              f.appendText(' — the other plugin supplies the name as well.');
            }),
            disabled: () =>
              this.pluginSettingsComponent.settings.folderNoteLocation !== FolderNoteLocation.InsideFolder
              && this.pluginSettingsComponent.settings.folderNoteLocation !== FolderNoteLocation.ParentFolder,
            name: 'Folder note name template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'folderNoteNameTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The ');
              appendCodeBlock(f, 'title');
              f.appendText(' property to write into the folder note of a folder that a reorder renumbered or ');
              appendCodeBlock(f, 'Rename folder...');
              f.appendText(' renamed.');
              f.createEl('br');
              appendCodeBlock(f, '{{folderName}}');
              f.appendText(' is the new folder name with its number, ');
              appendCodeBlock(f, '{{safeFolderName}}');
              f.appendText(' the same name without it.');
              f.createEl('br');
              f.appendText('One template for both, because they write the same property of the same note.');
              f.createEl('br');
              f.appendText('Leave empty to leave the property alone.');
              f.createEl('br');
              addReorderFolderTokens(f);
            }),
            name: 'Folder note title template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'folderNoteTitleTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The alias ');
              appendCodeBlock(f, 'Rename folder...');
              f.appendText(' writes into the renamed folder\'s folder note.');
              f.createEl('br');
              f.appendText('It REPLACES the alias the old name rendered and nothing else, so aliases you wrote by hand survive the rename.');
              f.createEl('br');
              f.appendText('A reorder never writes aliases. With the default ');
              appendCodeBlock(f, '{{safeFolderName}}');
              f.appendText(' the alias carries no number, so renumbering would not change it anyway.');
              f.createEl('br');
              f.appendText('Leave empty to leave the property alone.');
              f.createEl('br');
              addReorderFolderTokens(f);
            }),
            name: 'Folder note aliases template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'folderNoteAliasesTemplate', valueComponent: codeHighlighter });
              });
            }
          })
        ],
        name: 'Folder note'
      }),
      this.settingPage({
        desc: 'How renumbered folders and notes are named, and what a reorder writes into them.',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The name to give a folder renumbered by ');
              appendCodeBlock(f, 'Reorder sibling folders...');
              f.appendText(' or ');
              appendCodeBlock(f, 'Reorder child folders...');
              f.appendText('.');
              f.createEl('br');
              f.appendText('The whole format lives here: the separator is ordinary text, ');
              appendCodeBlock(f, '{{index:000}}');
              f.appendText(' zero-pads to the width of the mask, and the number does not have to come first — ');
              appendCodeBlock(f, '{{safeFolderName}} ({{index}})');
              f.appendText(' works too. Reading an existing number back uses this same template, so the two can never disagree.');
              f.createEl('br');
              f.appendText('Separate from ');
              appendCodeBlock(f, 'Create folder name template');
              f.appendText(' on purpose, so reordering can follow a different scheme from creating.');
              f.createEl('br');
              addReorderFolderTokens(f);
            }),
            name: 'Reordered folder name template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'reorderedFolderNameTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The name to give a renumbered note. The extension is never touched.');
              f.createEl('br');
              addReorderFileTokens(f);
            }),
            name: 'Reordered file name template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'reorderedFileNameTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The ');
              appendCodeBlock(f, 'title');
              f.appendText(' property to write into a renumbered note.');
              f.createEl('br');
              f.appendText('Empty by default, which leaves the property alone: only folders were asked for, so a reordered note is renamed and nothing else until you fill this in.');
              f.createEl('br');
              addReorderFileTokens(f);
            }),
            name: 'Reordered file title template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'reorderedFileTitleTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether a reorder also offers the folder\'s notes, and not only its folders.');
              f.createEl('br');
              f.appendText('This seeds the ');
              appendCodeBlock(f, 'Include files');
              f.appendText(' checkbox in the reorder dialog, where the choice is made while that checkbox is offered — with per-operation option overrides turned off, this setting decides it outright. Folders and files are always numbered as two separate sequences, because the file explorer sorts folders above files.');
            }),
            name: 'Should include files when reordering by default',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeFilesWhenReorderingByDefault', valueComponent: toggle });
              });
            }
          })
        ],
        name: 'Reorder'
      }),
      this.settingPage({
        desc: 'Menus, notices, and the instruction bar at the bottom of the modal dialogs.',
        items: [
          this.settingEx({
            desc: 'Whether to add commands to the submenu.',
            name: 'Should add commands to submenu',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAddCommandsToSubmenu', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether every operation reports itself: a notice while it runs, and a notice naming what it did once it finished.');
              f.createEl('br');
              f.appendText('Covers merging, splitting/extracting, swapping, moving, flattening, renaming a heading and reordering headings.');
              f.createEl('br');
              f.appendText('Refusals and errors are always shown, whatever this is set to.');
              f.createEl('br');
              f.appendText('The running notice is what carries the ');
              appendCodeBlock(f, 'Cancel');
              f.appendText(' button, so turning this off also hides it. An operation can still be cancelled by right-clicking the lock indicator and unlocking the note.');
            }),
            name: 'Should show operation notices',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({
                  onChanged: () => {
                    // The blocking-dialog row below only reads this through its `disabled` predicate.
                    this.refreshDomState();
                  },
                  propertyName: 'shouldShowOperationNotices',
                  valueComponent: toggle
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Report progress in a dialog that blocks the vault instead of in a notice.');
              f.createEl('br');
              f.appendText(
                'The operations rewrite links, names, folder paths and frontmatter across many notes. A notice says so while leaving Obsidian clickable, so a second operation can be started on top of a half-applied first one.'
              );
              f.createEl('br');
              f.appendText(
                'The dialog stays up until the work QUEUED by the operation has drained too, not just until the operation returns: renaming a file makes other plugins queue their own link updates, and those run afterwards.'
              );
              f.createEl('br');
              f.appendText('Needs ');
              appendCodeBlock(f, 'Should show operation notices');
              f.appendText(' to be on, since that is what turns progress reporting on at all.');
            }),
            disabled: () => !this.pluginSettingsComponent.settings.shouldShowOperationNotices,
            name: 'Should block the vault during operations',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldBlockVaultDuringOperations', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the modal dialogs offer the controls that override a setting for a single operation.');
              f.createEl('br');
              f.appendText('Covers the instruction bar at the bottom of the merge/split/swap pickers, with its checkboxes, dropdowns and keyboard hints; the ');
              appendCodeBlock(f, 'Include files');
              f.appendText(' checkbox in the reorder dialog; and the ');
              appendCodeBlock(f, 'Create');
              f.appendText(' / ');
              appendCodeBlock(f, 'Merge');
              f.appendText(' switch above the split picker.');
              f.createEl('br');
              f.appendText('When disabled, every operation uses the configured default settings and the option-toggle keyboard shortcuts are unavailable, so this page is the only place those choices are made.');
              f.createEl('br');
              f.appendText('The ');
              appendCodeBlock(f, 'Don\'t ask again');
              f.appendText(' checkbox in the confirmation dialogs is NOT covered: it changes a setting rather than overriding one for a single operation.');
            }),
            name: 'Should show per-operation option overrides',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowModalInstructions', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Which of the two recencies a picker offers first when you have typed nothing.');
              f.createEl('br');
              appendCodeBlock(f, 'Recent targets first');
              f.appendText(
                ' - the destinations of completed operations, then the folder you are in. Pick this if you run several operations into the same folder without navigating there.'
              );
              f.createEl('br');
              appendCodeBlock(f, 'Active file first');
              f.appendText(
                ' - the folder you are currently in, then the destinations of completed operations. Pick this if you navigate to where you want things to go.'
              );
              f.createEl('br');
              f.appendText('Both are reasonable and the two only disagree once you have run an operation, which is why this is a choice rather than a fix.');
            }),
            name: 'Picker recency order',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep enum order. */
                  [PickerRecencyOrder.RecentTargetsFirst]: 'Recent targets first',
                  [PickerRecencyOrder.ActiveFileFirst]: 'Active file first'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep enum order. */
                });
                this.bind({ propertyName: 'pickerRecencyOrder', valueComponent: dropdown });
              });
            }
          })
        ],
        name: 'UI'
      })
    ];
  }

  /**
   * Builds a navigable sub-page — the declarative counterpart of {@link PluginSettingsTab.settingGroupEx}
   * for a whole section.
   *
   * Obsidian 1.13 has no collapsible groups and its groups do not nest
   * (`SettingGroupItem = SettingDefinition | SettingDefinitionPage`), so a page is what gives this tab both
   * of the things issues #221 and #224/#225/#226 asked for: the tab opens as a short list of entries
   * instead of one long scroll, and a page holding groups IS the two-level hierarchy the subheadings need.
   *
   * @param params - The page params.
   * @returns The page definition.
   */
  private settingPage(params: PluginSettingsTabSettingPageParams): SettingDefinitionPage {
    return {
      ...params,
      type: 'page'
    };
  }
}

function addAvailableTokens(f: DocumentFragment, shouldIncludeContentToken = true): void {
  f.appendText('Available tokens:');
  f.createEl('br');
  if (shouldIncludeContentToken) {
    f.appendText('- ');
    appendCodeBlock(f, '{{content}}');
    f.createEl('br');
  }
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
  appendCodeBlock(f, '{{fromParentFolder}}');
  f.appendText(' / ');
  appendCodeBlock(f, '{{newParentFolder}}');
  f.appendText(' - the source / destination note\'s parent folder name (');
  appendCodeBlock(f, '{{parentFolder}}');
  f.appendText(' is an alias for ');
  appendCodeBlock(f, '{{newParentFolder}}');
  f.appendText(').');
  f.createEl('br');
  f.appendText('- ');
  appendCodeBlock(f, '{{date:FORMAT}}');
  f.appendText(', e.g. ');
  appendCodeBlock(f, '{{date:YYYY-MM-DD}}');
  f.appendText(' — and ');
  appendCodeBlock(f, '{{time:FORMAT}}');
  f.createEl('br');
  addTargetFolderTokens(f);
}

/**
 * Lists the tokens of the `Create folder with notes...` templates. A separate list from
 * {@link addAvailableTokens} because the vocabularies do not overlap — there is no source/destination note
 * pair here, only the folder being created.
 *
 * @param f - The fragment to append to.
 * @param shouldIncludeFolderTokens - Whether the tokens naming the CREATED folder are listed. They are
 * unavailable in the folder-name template, which is what produces them.
 */
function addCreateFolderTokens(f: DocumentFragment, shouldIncludeFolderTokens: boolean): void {
  f.appendText('Available tokens:');
  f.createEl('br');
  const tokens = ['{{index}}', '{{rawFolderName}}', '{{safeFolderName}}'];
  if (shouldIncludeFolderTokens) {
    tokens.push('{{folderName}}', '{{folderPath}}');
  }
  tokens.push('{{parentFolder}}', '{{parentFolderPath}}', '{{date}}', '{{time}}');
  for (const token of tokens) {
    f.appendText('- ');
    appendCodeBlock(f, token);
    f.createEl('br');
  }
  appendCodeBlock(f, '{{safeFolderName}}');
  f.appendText(' is the typed name after normalization, without the index. ');
  appendCodeBlock(f, '{{folderName}}');
  f.appendText(' is the folder\'s real final name, index included.');
}

function addReorderFileTokens(f: DocumentFragment): void {
  addTokenList(f, ['{{index}}', '{{safeName}}', '{{name}}', '{{extension}}', '{{parentFolder}}', '{{parentFolderPath}}', '{{path}}', '{{date}}', '{{time}}']);
  appendCodeBlock(f, '{{safeName}}');
  f.appendText(' is the basename without the number. ');
  appendCodeBlock(f, '{{name}}');
  f.appendText(' is the new basename with it, and is available in the title template only — the name template is what produces it.');
}

function addReorderFolderTokens(f: DocumentFragment): void {
  addTokenList(f, ['{{index}}', '{{safeFolderName}}', '{{folderName}}', '{{parentFolder}}', '{{parentFolderPath}}', '{{folderPath}}', '{{date}}', '{{time}}']);
  appendCodeBlock(f, '{{safeFolderName}}');
  f.appendText(' is the folder name without the number. ');
  appendCodeBlock(f, '{{folderName}}');
  f.appendText(' is the new name with it, and is available in the title template only — the name template is what produces it.');
}

/**
 * Lists the folder-flavored tokens the note templates share with the `Create folder with notes...` ones
 * (issue #227), and says which folder they name here.
 *
 * A block of its own under {@link addAvailableTokens} rather than more entries in its list: what makes them
 * usable is knowing WHICH folder they describe, which is a sentence, not a bullet.
 *
 * @param f - The fragment to append to.
 */
function addTargetFolderTokens(f: DocumentFragment): void {
  f.appendText('The tokens of ');
  appendCodeBlock(f, 'Create folder with notes...');
  f.appendText(' work here too, naming the folder the new note ends up in — which with ');
  appendCodeBlock(f, 'Split into folder');
  f.appendText(' on is the folder the split just created:');
  f.createEl('br');
  addTokenList(f, ['{{folderName}}', '{{folderPath}}', '{{safeFolderName}}', '{{index}}', '{{parentFolderPath}}']);
  appendCodeBlock(f, '{{safeFolderName}}');
  f.appendText(' is that folder\'s name without its number and ');
  appendCodeBlock(f, '{{index}}');
  f.appendText(' is the number itself (empty when the folder has none), both read back through ');
  appendCodeBlock(f, 'Reordered folder name template');
  f.appendText(' — so ');
  appendCodeBlock(f, '{{index:000}}');
  f.appendText(' zero-pads here as it does there.');
  f.createEl('br');
  appendCodeBlock(f, '{{rawFolderName}}');
  f.appendText(' and ');
  appendCodeBlock(f, '{{file}}');
  f.appendText(' are not available: there is no folder-name prompt to have typed, and a split writes one note.');
}

function addTokenList(f: DocumentFragment, tokens: readonly string[]): void {
  f.appendText('Available tokens:');
  f.createEl('br');
  for (const token of tokens) {
    f.appendText('- ');
    appendCodeBlock(f, token);
    f.createEl('br');
  }
}

function appendPathFormsDesc(f: DocumentFragment): void {
  f.appendText('A path string matches that note or folder and everything inside it, so ');
  appendCodeBlock(f, 'Inbox');
  f.appendText(' covers ');
  appendCodeBlock(f, 'Inbox');
  f.appendText(', ');
  appendCodeBlock(f, 'Inbox/note.md');
  f.appendText(' and ');
  appendCodeBlock(f, 'Inbox/sub/deep.md');
  f.appendText('.');
  f.createEl('br');
  f.appendText('A regular expression is tested against the path exactly as written, which is how you match a folder without its contents: ');
  appendCodeBlock(f, '/^Inbox$/');
  f.appendText(' matches only the ');
  appendCodeBlock(f, 'Inbox');
  f.appendText(' folder itself.');
  f.createEl('br');
  f.appendText('If any line is not a valid regular expression, the whole list is ignored until you fix it.');
}
