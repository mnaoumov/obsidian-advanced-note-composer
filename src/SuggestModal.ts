import type {
  App,
  Editor,
  FileManager,
  Pos,
  SearchResult,
  SuggestModal,
  TFile
} from 'obsidian';
import type { Factories } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import type { NoteComposerPluginInstance } from 'obsidian-typings';
import type { Constructor } from 'type-fest';

import {
  getFrontMatterInfo,
  parseLinktext
} from 'obsidian';
import { addAlias } from 'obsidian-dev-utils/obsidian/FileManager';
import {
  editLinks,
  updateLink,
  updateLinksInContent
} from 'obsidian-dev-utils/obsidian/Link';
import { getBacklinksForFileSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';
import { invokeWithPatchAsync } from 'obsidian-dev-utils/obsidian/MonkeyAround';

import type { AdvancedNoteComposerPlugin } from './AdvancedNoteComposerPlugin.ts';

import {
  INVALID_CHARACTERS_REG_EXP,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from './FilenameValidation.ts';

export type MergeFileSuggestModalConstructor = new (app: App, noteComposerPluginInstance: NoteComposerPluginInstance) => SuggestModalBase;
export type SplitFileSuggestModalConstructor = new (
  app: App,
  editor: Editor,
  noteComposerPluginInstance: NoteComposerPluginInstance,
  heading?: string
) => SuggestModalBase;

export interface SuggestItem {
  downranked: boolean;
  file: TFile;
  match: SearchResult;
  type: 'file';
}
export interface SuggestModalBase extends SuggestModal<SuggestItem> {
  currentFile: TFile;
  editor?: Editor;

  fixBacklinks(targetFile: TFile): Promise<void>;
  getSuggestions(query: string): Promise<SuggestItem[]> | SuggestItem[];
  mergeFile?(targetFile: TFile, sourceFile: TFile, position?: 'append' | 'prepend'): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  onChooseSuggestion(item: SuggestItem, evt: KeyboardEvent | MouseEvent): Promise<void>;
  renderSuggestion(value: SuggestItem, el: HTMLElement): void;
  setCurrentFile(file: TFile): void;
}

type CreateNewMarkdownFileFromLinktextFn = FileManager['createNewMarkdownFileFromLinktext'];

interface Frontmatter {
  title?: string;
}

type InsertIntoFileFn = FileManager['insertIntoFile'];

interface Selection {
  endOffset: number;
  startOffset: number;
}

export function extendSuggestModal<TConstructor extends Constructor<SuggestModalBase>>(
  plugin: AdvancedNoteComposerPlugin,
  OriginalSuggestModal: TConstructor
): TConstructor {
  return class PatchedSuggestModal extends OriginalSuggestModal {
    private backlinksToFix = new Map<string, string[]>();
    private shouldIncludeFrontmatter = false;
    private fileManagerPatch: Factories<FileManager> = {
      createNewMarkdownFileFromLinktext: (next: CreateNewMarkdownFileFromLinktextFn): CreateNewMarkdownFileFromLinktextFn => {
        return (filename, path) => createNewMarkdownFileFromLinktext(next, plugin, filename, path);
      },
      insertIntoFile: (next: InsertIntoFileFn): InsertIntoFileFn => {
        return (file: TFile, text: string, insertIntoFilePosition?: 'append' | 'prepend') =>
          insertIntoFile(next, this, file, text, insertIntoFilePosition, this.shouldIncludeFrontmatter);
      }
    };

    public override async fixBacklinks(targetFile: TFile): Promise<void> {
      for (const backlinkPath of this.backlinksToFix.keys()) {
        const linkJsons = this.backlinksToFix.get(backlinkPath) ?? [];
        await editLinks(this.app, backlinkPath, (link) => {
          if (!linkJsons.includes(JSON.stringify(link))) {
            return;
          }

          return updateLink({
            app: this.app,
            link,
            newSourcePathOrFile: this.currentFile,
            newTargetPathOrFile: targetFile
          });
        });
      }
    }

    public override async mergeFile(targetFile: TFile, sourceFile: TFile, position?: 'append' | 'prepend'): Promise<void> {
      await invokeWithPatchAsync(this.app.fileManager, this.fileManagerPatch, async () => {
        await super.mergeFile?.call(this, targetFile, sourceFile, position);
      });
    }

    public override async onChooseSuggestion(item: SuggestItem, evt: KeyboardEvent | MouseEvent): Promise<void> {
      await invokeWithPatchAsync(this.app.fileManager, this.fileManagerPatch, async () => {
        await this.prepareBacklinksToFix();
        await super.onChooseSuggestion(item, evt);
      });
    }

    public override onOpen(): void {
      super.onOpen();

      if (this.editor) {
        this.instructionsEl.createEl('label', {}, (label) => {
          label.createEl('input', { type: 'checkbox' }, (checkbox) => {
            checkbox.addEventListener('change', () => {
              this.shouldIncludeFrontmatter = checkbox.checked;
            });
          });
          label.appendText('Include frontmatter');
        });
      }
    }

    private async getSelections(): Promise<Selection[]> {
      if (this.editor) {
        return this.editor.listSelections().map((editorSelection) => {
          const selection: Selection = {
            endOffset: this.editor?.posToOffset(editorSelection.anchor) ?? 0,
            startOffset: this.editor?.posToOffset(editorSelection.head) ?? 0
          };

          if (selection.startOffset > selection.endOffset) {
            [selection.startOffset, selection.endOffset] = [selection.endOffset, selection.startOffset];
          }

          return selection;
        });
      }

      const content = await this.app.vault.read(this.currentFile);

      return [{
        endOffset: content.length,
        startOffset: 0
      }];
    }

    private async prepareBacklinksToFix(): Promise<void> {
      const selections = await this.getSelections();
      const cache = this.app.metadataCache.getFileCache(this.currentFile) ?? {};
      const subpaths = new Set<string>();

      for (const heading of cache.headings ?? []) {
        if (!isSelected(heading.position, selections)) {
          continue;
        }

        subpaths.add(`#${heading.heading}`);
      }

      for (const block of Object.values(cache.blocks ?? {})) {
        if (!isSelected(block.position, selections)) {
          continue;
        }

        subpaths.add(`#^${block.id}`);
      }

      const backlinks = await getBacklinksForFileSafe(this.app, this.currentFile);
      this.backlinksToFix.clear();

      for (const backlinkPath of backlinks.keys()) {
        const links = backlinks.get(backlinkPath) ?? [];
        for (const link of links) {
          const { subpath } = parseLinktext(link.link);
          if (!subpaths.has(subpath)) {
            continue;
          }

          let referenceJsons = this.backlinksToFix.get(backlinkPath);

          if (!referenceJsons) {
            referenceJsons = [];
            this.backlinksToFix.set(backlinkPath, referenceJsons);
          }

          referenceJsons.push(JSON.stringify(link));
        }
      }
    }
  };
}

async function createNewMarkdownFileFromLinktext(
  next: CreateNewMarkdownFileFromLinktextFn,
  plugin: AdvancedNoteComposerPlugin,
  filename: string,
  path: string
): Promise<TFile> {
  const app = plugin.app;
  const fixedFilename = fixFilename(filename, plugin);
  const file = await next.call(app.fileManager, fixedFilename, path);

  if (fixedFilename !== filename) {
    if (plugin.settings.shouldAddInvalidTitleToNoteAlias) {
      await addAlias(app, file, filename);
    }

    if (plugin.settings.shouldAddInvalidTitleToFrontmatterTitleKey) {
      await app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        frontmatter.title = filename;
      });
    }
  }

  return file;
}

function fixFilename(filename: string, plugin: AdvancedNoteComposerPlugin): string {
  const app = plugin.app;
  if (!plugin.settings.shouldReplaceInvalidTitleCharacters || isValidFilename(app, filename)) {
    return filename;
  }

  filename = filename.replaceAll(INVALID_CHARACTERS_REG_EXP, (substring) => plugin.settings.replacement.repeat(substring.length));
  filename = filename.replaceAll(TRAILING_DOTS_OR_SPACES_REG_EXP, (substring) => plugin.settings.replacement.repeat(substring.length));
  if (filename.startsWith('.')) {
    filename = plugin.settings.replacement + filename.slice(1);
  }

  filename ||= 'Untitled';
  return filename;
}

async function fixLinks(app: App, sourceFile: TFile, targetFile: TFile, content: string): Promise<string> {
  if (sourceFile.parent === targetFile.parent) {
    return content;
  }

  return await updateLinksInContent({
    app,
    content,
    newSourcePathOrFile: targetFile,
    oldSourcePathOrFile: sourceFile
  });
}

async function insertIntoFile(
  next: InsertIntoFileFn,
  suggestModal: SuggestModalBase,
  file: TFile,
  text: string,
  position: 'append' | 'prepend' | undefined,
  shouldIncludeFrontmatter: boolean
): Promise<void> {
  const app = suggestModal.app;
  const newText = await fixLinks(app, suggestModal.currentFile, file, text);
  await next.call(app.fileManager, file, newText, position);
  await suggestModal.fixBacklinks(file);
  if (!shouldIncludeFrontmatter) {
    return;
  }

  const content = await app.vault.read(suggestModal.currentFile);
  const frontmatterInfo = getFrontMatterInfo(content);
  if (!frontmatterInfo.exists) {
    return;
  }
  const fullFrontmatter = `---\n${frontmatterInfo.frontmatter}\n---`;
  await insertIntoFile(next, suggestModal, file, fullFrontmatter, position, false);
}

function isSelected(position: Pos, selections: Selection[]): boolean {
  return selections.some((selection) => {
    return selection.startOffset <= position.start.offset && position.end.offset <= selection.endOffset;
  });
}

function isValidFilename(app: App, filename: string): boolean {
  try {
    app.vault.checkPath(filename);
    return true;
  } catch {
    return false;
  }
}
