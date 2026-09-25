import type {
  App,
  TFile
} from 'obsidian';

import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/file-system';

import type { TemplaterPreludeTokens } from './templater-prelude.ts';

import { buildTemplaterPrelude } from './templater-prelude.ts';
import { TEMPLATER_RUN_MODE_DYNAMIC_PROCESSOR } from './templater.ts';

/**
 * What makes a resolved template Templater's problem rather than ours. Checked on the template AFTER the
 * plugin's own `{{tokens}}` are resolved, so a token value holding a literal `<%` still reaches Templater —
 * which is what the user asked for by putting it there.
 */
const TEMPLATER_COMMAND_START = '<%';

/**
 * What splits a rendered value into the lines a single-line value was never allowed to have. Matches every
 * line ending a template can emit, including a lone `\r`.
 */
const LINE_BREAK_REG_EXP = /\r\n|[\r\n]/;

/**
 * How far down Obsidian's recent list {@link resolveTemplaterContextFile} looks for a note that still exists.
 * Obsidian's own default is `10`; a handful more costs nothing here, since the search stops at the first path
 * that resolves and only runs when no note is open at all.
 */
const RECENT_FILE_PATHS_MAX_COUNT = 50;

/**
 * Parameters for {@link renderSingleLineValueWithTemplater} — the same as for {@link renderStringWithTemplater},
 * which it wraps.
 */
export type RenderSingleLineValueWithTemplaterParams = RenderStringWithTemplaterParams;

/**
 * Parameters for {@link renderStringWithTemplater}.
 */
export interface RenderStringWithTemplaterParams {
  readonly app: App;

  /**
   * The note the Templater run reports on through `tp.file.*`, or `null` to let
   * {@link resolveTemplaterContextFile} find one.
   *
   * Not optional decoration: Templater reads `target_file.basename` / `target_file.stat` EAGERLY while
   * building its function object, so a run with no file at all throws before the template is even parsed.
   */
  readonly contextFile: null | TFile;

  /**
   * The template with the plugin's own `{{tokens}}` already resolved.
   */
  readonly resolvedTemplate: string;

  /**
   * The setting's display name, which every refusal starts with so the user knows which box to fix.
   */
  readonly settingName: string;

  /**
   * The values exposed to Templater code as `TOKENS`.
   */
  readonly tokens: TemplaterPreludeTokens;
}

/**
 * Parameters for {@link renderValueListWithTemplater} — the same as for {@link renderStringWithTemplater},
 * which it wraps.
 */
export type RenderValueListWithTemplaterParams = RenderStringWithTemplaterParams;

/**
 * The `cause` chain a {@link TemplateRenderError} carries. Named for the rule that a supplementary bag is
 * `*Options`, prefixed by what it belongs to.
 */
type TemplateRenderErrorConstructorOptions = ErrorOptions;

/**
 * Everything {@link renderStringWithTemplater} and {@link renderSingleLineValueWithTemplater} refuse, as one
 * type — so a caller can report a MISCONFIGURED template as a notice while a genuine bug still reaches the
 * unhandled-error handler (issue #203's reasoning, now shared by every string template).
 */
export class TemplateRenderError extends Error {
  public constructor(message: string, options?: TemplateRenderErrorConstructorOptions) {
    super(message, options);
    this.name = 'TemplateRenderError';
  }
}

/**
 * Renders a template that produces ONE property value — a folder note's `title` or alias, a reordered note's
 * `title` (issue #284) — through {@link renderStringWithTemplater}, trimmed and refused when it spans more
 * than one line.
 *
 * The refusal mirrors the name transform's (issue #203): writing one Templater command per line makes each
 * command emit its own result, and a property silently holding two values glued by a line break is a wrong
 * answer where a loud failure was due.
 *
 * @param params - The resolved template, its tokens and the Templater context.
 * @returns The value, trimmed.
 */
export async function renderSingleLineValueWithTemplater(params: RenderSingleLineValueWithTemplaterParams): Promise<string> {
  const renderedValue = await renderStringWithTemplater(params);
  const value = renderedValue.trim();
  if (!LINE_BREAK_REG_EXP.test(value)) {
    return value;
  }

  throw new TemplateRenderError(
    `${params.settingName} produced a multi-line value. A property value must be a single line.`
      + ' Chain the commands into one expression instead of writing one command per line.'
  );
}

/**
 * Hands a string template to Templater when — and only when — it still holds a Templater command once the
 * plugin's own `{{tokens}}` are resolved.
 *
 * This is the second stage of the `Name transform template` (issue #196), lifted out once the folder-note
 * property templates wanted the same thing (issue #284). A template that is nothing but tokens never touches
 * Templater, so its presence is the opt-in and no setting gates it: `Should run templater on destination file`
 * names the destination FILE, which a string template does not have.
 *
 * The run uses Templater's `DynamicProcessor` mode (parse and hand back, write nothing) with the same `TOKENS`
 * prelude the created notes get, so `<% TOKENS.safeFolderName.toUpperCase() %>` works as readily as any
 * `tp.*` call. Every failure throws a {@link TemplateRenderError} naming the setting.
 *
 * @param params - The resolved template, its tokens and the Templater context.
 * @returns The rendered string, untrimmed.
 */
export async function renderStringWithTemplater(params: RenderStringWithTemplaterParams): Promise<string> {
  const {
    app,
    contextFile,
    resolvedTemplate,
    settingName,
    tokens
  } = params;

  if (!resolvedTemplate.includes(TEMPLATER_COMMAND_START)) {
    return resolvedTemplate;
  }

  const templaterPlugin = app.plugins.plugins['templater-obsidian'];
  if (!templaterPlugin) {
    throw new TemplateRenderError(`${settingName} uses Templater syntax, but the Templater plugin is not installed`);
  }

  const targetFile = resolveTemplaterContextFile(app, contextFile);
  if (!targetFile) {
    throw new TemplateRenderError(`${settingName} uses Templater syntax, which needs a note as its context, and this vault has none`);
  }

  const runningConfig = templaterPlugin.templater.create_running_config(undefined, targetFile, TEMPLATER_RUN_MODE_DYNAMIC_PROCESSOR);
  try {
    return await templaterPlugin.templater.parse_template(runningConfig, `${buildTemplaterPrelude(tokens)}${resolvedTemplate}`);
  } catch (error) {
    throw new TemplateRenderError(`${settingName} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Renders a template that produces a LIST of property values — a folder note's aliases (issue #294) —
 * through {@link renderStringWithTemplater}, one value per line.
 *
 * A line break is the separator because no usable value can contain one, so it is never ambiguous the way a
 * comma would be. That covers a plain `{{token}}` template written over several lines and a Templater one
 * alike: Templater concatenates what its commands emit into a string, so an expression that computes an
 * array hands it over with `.join("\n")`. Each line is trimmed, blank lines are dropped and a repeated value
 * is kept once.
 *
 * @param params - The resolved template, its tokens and the Templater context.
 * @returns The values, in the order the template produced them.
 */
export async function renderValueListWithTemplater(params: RenderValueListWithTemplaterParams): Promise<string[]> {
  const renderedValue = await renderStringWithTemplater(params);
  const values = renderedValue.split(LINE_BREAK_REG_EXP).map((line) => line.trim()).filter((line) => line !== '');
  return [...new Set(values)];
}

/**
 * Resolves the note the Templater run reports on through `tp.file.*` (issue #218).
 *
 * Templater insists on a file — it reads `target_file.basename`/`.stat` EAGERLY (see `templater.ts`) — but
 * the commands that need a string template most are the folder ones, which have no note of their own, so
 * requiring an OPEN note made a configured `Name transform template` refuse every folder command whenever
 * the user had no note focused. That was issue #218, reported twice over: as a validator message in
 * `Create folder with notes...`'s name prompt and as a notice from
 * `Merge folder contents into a single file...`, both of them this one refusal.
 *
 * So a file is found rather than demanded, in falling order of how much it has to do with the user: the
 * caller's own subject, the open note, the note last open, the note last written. The refusal survives only
 * for a vault holding no note at all, where there is genuinely nothing to hand over.
 *
 * **The fallbacks are not a new class of silent wrongness.** The context here has ALWAYS been "whatever note
 * happens to be open", which for a command operating on a folder is exactly as arbitrary as "the note you
 * last had open" — and the usual template never touches `tp.file.*` at all: Templater is the expression
 * evaluator, and the file it insists on is incidental. One chain shared by every name-transform call site is
 * also why that template gets no per-command anchor (the folder merge offering one of its merged notes, a
 * rename offering the folder note): that would make the same template report a different `tp.file.title`
 * depending on which command ran it. A PROPERTY template is different in kind — it has an obvious subject,
 * the note it writes into, and passes it (issue #284).
 *
 * The fallback note is read, never written, so it is deliberately NOT filtered through `isPathIgnored` — this
 * module takes no settings, and a note excluded from being an operation's target is still a note.
 *
 * @param app - The app.
 * @param contextFile - The caller's own note, when it has one.
 * @returns The note to run the template against, or `null` when the vault has none.
 */
export function resolveTemplaterContextFile(app: App, contextFile: null | TFile): null | TFile {
  // The active file is taken as it comes, `isMarkdownFile` unchecked: with a canvas focused it is what the
  // run has always reported on, and narrowing that now would be a second, unasked-for change.
  return contextFile
    ?? app.workspace.getActiveFile()
    ?? resolveMostRecentlyOpenedNote(app)
    ?? resolveMostRecentlyModifiedNote(app);
}

/**
 * The newest note in the vault by modification time — the last note the user actually wrote in, when
 * Obsidian's recent list has nothing left to offer.
 *
 * A vault that has never had a note opened (a fresh install, an Obsidian launched straight into the file
 * explorer) has an EMPTY recent list, so without this step a string template would still refuse in a vault
 * full of notes. Ties break on the path so that two notes written in the same millisecond — which
 * `Create folder with notes...` produces by the handful — cannot make the same run pick differently twice.
 *
 * @param app - The app.
 * @returns The newest note, or `null` in a vault with no note at all.
 */
function resolveMostRecentlyModifiedNote(app: App): null | TFile {
  let newestNote: null | TFile = null;
  for (const note of app.vault.getMarkdownFiles()) {
    if (!newestNote || note.stat.mtime > newestNote.stat.mtime || (note.stat.mtime === newestNote.stat.mtime && note.path < newestNote.path)) {
      newestNote = note;
    }
  }

  return newestNote;
}

/**
 * The most recently opened note that still exists — the note the user was looking at before they closed
 * everything, which is the closest thing to an active note there is when nothing is open.
 *
 * Obsidian's recent list is paths, not files, so an entry can name a note that has since been deleted or
 * renamed; the first one that still resolves wins. It is filtered by {@link isMarkdownFile} rather than
 * trusted to the `show*` options, because an image or a PDF is not a note and `tp.file.*` reporting on one
 * would be nonsense.
 *
 * Deliberately NOT `getRecentPaths` from `recent-suggestions.ts`, despite the overlap: that function leads
 * with the plugin's own recorded operation TARGETS, which are destinations and are often folders. "A folder
 * I merged into" is not "a note I was looking at".
 *
 * @param app - The app.
 * @returns The note, or `null` when the recent list is empty or nothing in it resolves.
 */
function resolveMostRecentlyOpenedNote(app: App): null | TFile {
  const recentPaths = app.workspace.getRecentFiles({
    maxCount: RECENT_FILE_PATHS_MAX_COUNT,
    showCanvas: false,
    showImages: false,
    showMarkdown: true,
    showNonAttachments: false,
    showNonImageAttachments: false
  });

  for (const path of recentPaths) {
    const note = app.vault.getFileByPath(path);
    if (note && isMarkdownFile(note)) {
      return note;
    }
  }

  return null;
}
