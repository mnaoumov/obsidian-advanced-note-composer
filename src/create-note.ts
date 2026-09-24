import type {
  App,
  TFile
} from 'obsidian';

import { addAlias } from 'obsidian-dev-utils/obsidian/file-manager';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { Frontmatter } from './frontmatter-merge.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { cleanTypedName } from './create-folder-name.ts';
import { transformAndFixFileName } from './name-transform.ts';
import { applyNumberedNoteName } from './numbered-note-name.ts';
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
   * Whether the typed name is CLEANED before anything else reads it (issue #283): trimmed, stripped of
   * leading/trailing dots, every whitespace run collapsed to one space, and Title Cased when
   * `shouldTitleCaseCreatedNoteName` is on — the rules `Create folder with notes...` applies to a typed folder
   * name.
   *
   * The two `Create empty note ...` commands pass `true`, because there the name is typed from scratch. A
   * split passes `false`: its name is usually a HEADING, and re-casing or re-spacing what a heading already
   * says would change the output of every existing extract.
   */
  readonly shouldCleanTypedName: boolean;

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
 * Parameters for {@link resolveTypedNoteName}.
 */
export type ResolveTypedNoteNameParams = Pick<CreateNoteFromTypedNameParams, 'fileName' | 'pluginSettingsComponent' | 'shouldCleanTypedName'>;

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
  const fileName = resolveTypedNoteName(params);
  const fixedFileName = `${await resolveFileName(params, fileName)}.md`;
  const file = await app.fileManager.createNewMarkdownFileFromLinktext(params.folderPrefix + fixedFileName, params.sourcePath);

  const overriddenBasename = relocateNote ? await relocateNote(file) : null;

  /*
   * Issue #269's "instead": the number goes on the FOLDER when the note was given one, and on the note
   * itself otherwise. Keyed off the relocation rather than off `shouldSplitIntoFolder` on purpose — both
   * call sites already derive `relocateNote` from that setting, and the recursive split FORCES it on
   * regardless of it, so reading the setting again here would be a second copy of the condition that could
   * disagree with the move that actually happened.
   */
  if (!relocateNote) {
    await applyNumberedNoteName({ app, file, pluginSettingsComponent });
  }

  /*
   * A `splitIntoFolderNoteNameTemplate` override renames the note away from the typed name, so the
   * typed name is recorded as an alias / frontmatter title exactly like any other changed title
   * (issue #153) — `Foo/Overview.md` still carries `Foo`, so `[[Foo]]` keeps resolving.
   *
   * An auto-numbered name (issue #269) is the same kind of change and needs no branch of its own:
   * `renameFile` mutates the note in place, so `file.basename` is already `5. D` by the time it is read
   * here — which is what keeps `[[D]]` resolving to it.
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
 * The name the note is created from, before the transform and the invalid-character pass: the typed name
 * without its `.md`, cleaned when the caller asks for it.
 *
 * Exported so a prompt's validator judges exactly the name {@link createNoteFromTypedName} will use.
 *
 * Cleaning runs FIRST, ahead of the `Name transform template` — unlike `Create folder with notes...`, which
 * transforms first — because this is also the name recorded as the alias / frontmatter `title`, and the
 * reporter's own `title` came out holding the very spacing and casing they asked to have cleaned.
 *
 * A name that cleans to nothing (only dots) is kept as typed, so it reaches the same `fixFileName` handling
 * it always did rather than becoming an empty name.
 *
 * @param params - The parameters.
 * @returns The name to create the note from.
 */
export function resolveTypedNoteName(params: ResolveTypedNoteNameParams): string {
  const fileName = trimEnd({ $string: params.fileName, suffix: '.md' });
  if (!params.shouldCleanTypedName) {
    return fileName;
  }

  return cleanTypedName({
    rawName: fileName,
    shouldTitleCase: params.pluginSettingsComponent.settings.shouldTitleCaseCreatedNoteName
  }) || fileName;
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
