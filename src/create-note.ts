import type {
  App,
  TFile
} from 'obsidian';

import { addAlias } from 'obsidian-dev-utils/obsidian/file-manager';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { Frontmatter } from './frontmatter-merge.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { transformAndFixFileName } from './name-transform.ts';
import { FrontmatterTitleMode } from './plugin-settings.ts';

/**
 * Parameters for {@link createNoteFromTypedName}.
 */
export interface CreateNoteFromTypedNameParams {
  readonly app: App;

  /**
   * The note a Templater-driven `Name transform template` reports on through `tp.file.*`, or `null` to let
   * `name-transform.ts` find one. A split passes its source note; a flow with no note of its own (the
   * folder menu) passes `null` and gets the shared fallback chain (issue #218).
   */
  readonly contextFile: null | TFile;

  /**
   * The name as typed, without the `.md` extension (a typed one is trimmed off).
   */
  readonly fileName: string;

  /**
   * What the resolved file name is created under — `/Some/Folder/` to pin the destination, or an empty
   * string to let Obsidian's own new-file resolution pick it.
   */
  readonly folderPrefix: string;
  readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * Moves the just-created note somewhere else BEFORE its title is judged, returning the base name it was
   * renamed to (or `null` when it kept the typed one). {@link SplitItemSelector} passes its own-folder move
   * here, which is what keeps `splitIntoFolderNoteNameTemplate` — and the source note its tokens read —
   * inside the selector that owns them; a flow with no such step passes `null`.
   *
   * It runs before the alias / frontmatter-title decisions on purpose: a note renamed away from the typed
   * name has an invalid title in exactly the same sense a sanitized one does (issue #153).
   */
  readonly relocateNote: ((file: TFile) => Promise<null | string>) | null;

  /**
   * Whether `/` keeps its meaning as a path separator in the typed name.
   */
  readonly shouldTreatTitleAsPath: boolean;

  /**
   * The path links in the new note are resolved against — the source note's path for a split, an empty
   * string when there is no such note.
   */
  readonly sourcePath: string;
}

/**
 * Creates a note from a name the user typed, applying every naming rule the plugin owns: the
 * `Name transform template` and the invalid-character pass (issue #196), the caller's own relocation step,
 * the `shouldAddInvalidTitleToNoteAlias` alias and the `frontmatterTitleMode` title (issue #153).
 *
 * It exists so the two flows that turn typed text into a note — the split/extract picker and the file
 * explorer's `Create empty note in folder...` (issue #244) — cannot disagree about any of them. Everything
 * the split used to need its SOURCE note for is a parameter here: the Templater context (already nullable in
 * `name-transform.ts`), the path links resolve against, and the destination folder.
 *
 * @param params - The typed name, where it goes, and the settings the naming rules read.
 * @returns The created note.
 */
export async function createNoteFromTypedName(params: CreateNoteFromTypedNameParams): Promise<TFile> {
  const {
    app,
    pluginSettingsComponent,
    relocateNote
  } = params;
  const fileName = trimEnd({ $string: params.fileName, suffix: '.md' });
  const fixedFileName = `${await resolveFileName(params, fileName)}.md`;
  const file = await app.fileManager.createNewMarkdownFileFromLinktext(params.folderPrefix + fixedFileName, params.sourcePath);

  const overriddenBasename = relocateNote ? await relocateNote(file) : null;

  /*
   * A `splitIntoFolderNoteNameTemplate` override renames the note away from the typed name, so the
   * typed name is recorded as an alias / frontmatter title exactly like any other changed title
   * (issue #153) — `Foo/Overview.md` still carries `Foo`, so `[[Foo]]` keeps resolving.
   */
  const isInvalidTitle = (overriddenBasename ?? file.basename) !== fileName;

  if (isInvalidTitle && pluginSettingsComponent.settings.shouldAddInvalidTitleToNoteAlias) {
    // The note was just created, so there is no open editor to lock while its alias is added.
    await addAlias({ alias: fileName, app, pathOrFile: file, resourceLockComponent: null });
  }

  let shouldAddTitleToFrontmatter = false;

  switch (pluginSettingsComponent.settings.frontmatterTitleMode) {
    case FrontmatterTitleMode.None: {
      break;
    }
    case FrontmatterTitleMode.UseAlways: {
      shouldAddTitleToFrontmatter = true;
      break;
    }
    case FrontmatterTitleMode.UseForInvalidTitleOnly: {
      shouldAddTitleToFrontmatter = isInvalidTitle;
      break;
    }
    default: {
      throw new Error(`Invalid frontmatter title mode: ${pluginSettingsComponent.settings.frontmatterTitleMode as string}`);
    }
  }

  if (shouldAddTitleToFrontmatter) {
    await app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
      frontmatter.title = fileName;
    });
  }

  return file;
}

/**
 * Runs the typed name through the `Name transform template` and then the invalid-character pass
 * (issue #196), in that order.
 *
 * @param params - The parameters.
 * @param fileName - The name as typed, with any `.md` suffix already trimmed off.
 * @returns The transformed, sanitized name.
 */
async function resolveFileName(params: CreateNoteFromTypedNameParams, fileName: string): Promise<string> {
  const { settings } = params.pluginSettingsComponent;
  return await transformAndFixFileName({
    app: params.app,
    contextFile: params.contextFile,
    fileName,
    nameTransformTemplate: settings.nameTransformTemplate,
    replacement: settings.replacement,
    shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
    shouldTreatTitleAsPath: params.shouldTreatTitleAsPath
  });
}
