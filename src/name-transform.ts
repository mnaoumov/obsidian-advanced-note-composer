import type {
  App,
  TFile
} from 'obsidian';

import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/file-system';

import type { NameTransformTokens } from './template-tokens.ts';

import { fixFileName } from './filename-validation.ts';
import { resolveNameTransformTokens } from './template-tokens.ts';
import { buildTemplaterPrelude } from './templater-prelude.ts';
import { TEMPLATER_RUN_MODE_DYNAMIC_PROCESSOR } from './templater.ts';

/**
 * What makes a resolved template Templater's problem rather than ours. Checked on the template AFTER the
 * plugin's own `{{tokens}}` are resolved, so `{{rawString}}` holding a literal `<%` still reaches Templater —
 * which is what the user asked for by putting it in the name.
 */
const TEMPLATER_COMMAND_START = '<%';

/**
 * What splits a transformed name into the lines it was never allowed to have. Matches every line ending a
 * template can emit, including a lone `\r`.
 */
const LINE_BREAK_REG_EXP = /\r\n|[\r\n]/;

/**
 * How far down Obsidian's recent list {@link resolveTemplaterContextFile} looks for a note that still exists.
 * Obsidian's own default is `10`; a handful more costs nothing here, since the search stops at the first path
 * that resolves and only runs when no note is open at all.
 */
const RECENT_FILE_PATHS_MAX_COUNT = 50;

/**
 * Parameters for {@link applyNameTransform}.
 */
export interface ApplyNameTransformParams {
  readonly app: App;

  /**
   * The note the Templater run reports on through `tp.file.*`, or `null` to let
   * {@link resolveTemplaterContextFile} find one.
   *
   * Not optional decoration: Templater reads `target_file.basename` / `target_file.stat` EAGERLY while
   * building its function object, so a run with no file at all throws before the template is even parsed.
   * A flow that has an obvious note (a split's source) passes it; the rest get the shared fallback chain,
   * which no longer requires a note to be OPEN (issue #218).
   */
  readonly contextFile: null | TFile;

  /**
   * The name as supplied, before any normalization.
   */
  readonly rawString: string;

  /**
   * The `nameTransformTemplate` setting. Empty skips the whole thing.
   */
  readonly template: string;
}

/**
 * Parameters for {@link transformAndFixFileName}.
 */
export interface TransformAndFixFileNameParams {
  readonly app: App;

  /**
   * See {@link ApplyNameTransformParams.contextFile}.
   */
  readonly contextFile: null | TFile;

  /**
   * The raw, user-supplied name to transform and sanitize (without the `.md` extension).
   */
  readonly fileName: string;

  /**
   * The `nameTransformTemplate` setting.
   */
  readonly nameTransformTemplate: string;

  /**
   * The `replacement` setting.
   */
  readonly replacement: string;

  /**
   * The `shouldReplaceInvalidTitleCharacters` setting.
   */
  readonly shouldReplaceInvalidCharacters: boolean;

  /**
   * Whether `/` keeps its meaning as a path separator.
   */
  readonly shouldTreatTitleAsPath: boolean;
}

/**
 * The `cause` chain a {@link NameTransformError} carries. Named for the rule that a supplementary bag is
 * `*Options`, prefixed by what it belongs to.
 */
type NameTransformErrorConstructorOptions = ErrorOptions;

/**
 * Everything {@link applyNameTransform} refuses, as one type.
 *
 * The flows that run the transform have no other way to tell a MISCONFIGURED template from a genuine bug:
 * both arrive as a rejected promise, and a caller that caught `Error` would turn every real failure into a
 * polite notice. So the transform's own refusals are typed, callers catch exactly this, and anything else
 * still reaches the unhandled-error handler where it belongs.
 */
export class NameTransformError extends Error {
  public constructor(message: string, options?: NameTransformErrorConstructorOptions) {
    super(message, options);
    this.name = 'NameTransformError';
  }
}

/**
 * Rewrites a user-supplied name through the `Name transform template` setting (issue #196), which is how a
 * vault expresses its OWN replacements instead of living with one universal `replacement` character.
 *
 * Two stages, and the second is skipped unless it is needed:
 *
 * 1. The plugin's own `{{rawString}}` (plus the shared `{{date}}` / `{{time}}`) are resolved. A template
 *    that is nothing but tokens never touches Templater, so the common case costs one regex pass.
 * 2. If what came out holds a Templater command, it is parsed by Templater with the same `TOKENS` binding
 *    the created notes get — so `<% TOKENS.rawString.replaceAll(":", " - ") %>` expresses any mapping,
 *    conditional ones included. That generality is the whole reason this is a template rather than a
 *    `FROM => TO` list: the list can only ever say what someone already thought of.
 *
 * **Every failure throws a {@link NameTransformError}, deliberately — nothing is silently left
 * untransformed.** The user configured a rewrite precisely so a name would not be mangled behind their back,
 * so a broken template must never quietly degrade into the universal replacement. In the
 * `Create folder with notes...` flow the throw lands in the prompt's validator, which shows the message and
 * re-asks with the typed text intact; elsewhere the flow catches this type, reports the message and aborts
 * before anything is created. Producing a MULTI-LINE name is one of those failures — see
 * {@link ensureSingleLineName}.
 *
 * What this does NOT do is decide what happens to characters the transform left invalid — that is
 * {@link fixFileName}'s job, governed by `shouldReplaceInvalidTitleCharacters`: on, they take the universal
 * `replacement`; off, they survive and the caller's existing validation refuses the name. That is issue
 * #196's "block the characters that have no replacement", with no third setting to reconcile.
 *
 * @param params - The name, the template and the Templater context.
 * @returns The transformed name, trimmed.
 */
export async function applyNameTransform(params: ApplyNameTransformParams): Promise<string> {
  const {
    app,
    contextFile,
    rawString,
    template
  } = params;

  if (!template) {
    return rawString;
  }

  const tokens: NameTransformTokens = { rawString };
  let resolvedTemplate: string;
  try {
    resolvedTemplate = resolveNameTransformTokens({ template, tokens });
  } catch (error) {
    // Same message, now typed — an unknown token key is a misconfiguration like any other refusal here.
    throw new NameTransformError(toMessage(error), { cause: error });
  }

  if (!resolvedTemplate.includes(TEMPLATER_COMMAND_START)) {
    return ensureSingleLineName(resolvedTemplate.trim());
  }

  const templaterPlugin = app.plugins.plugins['templater-obsidian'];
  if (!templaterPlugin) {
    throw new NameTransformError('Name transform template uses Templater syntax, but the Templater plugin is not installed');
  }

  const targetFile = resolveTemplaterContextFile(app, contextFile);
  if (!targetFile) {
    throw new NameTransformError('Name transform template uses Templater syntax, which needs a note as its context, and this vault has none');
  }

  const runningConfig = templaterPlugin.templater.create_running_config(undefined, targetFile, TEMPLATER_RUN_MODE_DYNAMIC_PROCESSOR);
  let parsed: string;
  try {
    parsed = await templaterPlugin.templater.parse_template(runningConfig, `${buildTemplaterPrelude(tokens)}${resolvedTemplate}`);
  } catch (error) {
    throw new NameTransformError(`Name transform template failed: ${toMessage(error)}`, { cause: error });
  }

  return ensureSingleLineName(parsed.trim());
}

/**
 * {@link applyNameTransform} followed by {@link fixFileName} — the full "typed text to file name" pipeline,
 * in the one order that is correct.
 *
 * It exists so the flows that turn a name into a file name cannot disagree about that order. Transforming
 * FIRST is what makes the feature work at all: run the other way round, `:` would already have become `_`
 * and the template would have nothing left to map.
 *
 * `Create folder with notes...` does not use this — it has its own trim / dots / whitespace / Title Case
 * steps to run in between — but it applies the same two ends in the same order.
 *
 * @param params - The name, the transform template and the sanitization settings.
 * @returns The transformed, sanitized name.
 */
export async function transformAndFixFileName(params: TransformAndFixFileNameParams): Promise<string> {
  const {
    app,
    contextFile,
    fileName,
    nameTransformTemplate,
    replacement,
    shouldReplaceInvalidCharacters,
    shouldTreatTitleAsPath
  } = params;

  const transformedName = await applyNameTransform({
    app,
    contextFile,
    rawString: fileName,
    template: nameTransformTemplate
  });

  return fixFileName({
    fileName: transformedName,
    replacement,
    shouldReplaceInvalidCharacters,
    shouldTreatTitleAsPath
  });
}

/**
 * Refuses a transformed name that spans more than one line (issue #203).
 *
 * A file name is a single line — a line break is not an "invalid character" {@link fixFileName} could replace,
 * it is a name the file system cannot hold at all, and before this the break survived every sanitization step
 * and only failed at `vault.create`, as an unhandled error naming nothing.
 *
 * It is refused rather than joined on purpose. The template that produced it is broken, and the reporter of
 * issue #203 wrote one Templater command per LINE — joining would have silently created `Test - a Test  a`
 * and turned a loud failure into a wrong name, which is exactly what the "every failure throws" rule above
 * exists to prevent. Only INTERIOR breaks count: both callers trim first, so a `-%>` block's trailing newline
 * is not an error.
 *
 * @param name - The trimmed, transformed name.
 * @returns The name, when it is a single line.
 */
function ensureSingleLineName(name: string): string {
  if (!LINE_BREAK_REG_EXP.test(name)) {
    return name;
  }

  const lines = name.split(new RegExp(LINE_BREAK_REG_EXP.source, 'g'))
    .map((line) => line.trim())
    .filter((line) => !!line);
  throw new NameTransformError(
    `Name transform template produced a multi-line name: ${lines.map((line) => `'${line}'`).join(' / ')}.`
      + ' A note name must be a single line. Chain the replacements into one expression'
      + ' instead of writing one command per line.'
  );
}

/**
 * The newest note in the vault by modification time — the last note the user actually wrote in, when
 * Obsidian's recent list has nothing left to offer.
 *
 * A vault that has never had a note opened (a fresh install, an Obsidian launched straight into the file
 * explorer) has an EMPTY recent list, so without this step {@link applyNameTransform} would still refuse in
 * a vault full of notes. Ties break on the path so that two notes written in the same millisecond — which
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

/**
 * Resolves the note the Templater run reports on through `tp.file.*` (issue #218).
 *
 * Templater insists on a file — it reads `target_file.basename`/`.stat` EAGERLY (see `templater.ts`) — but
 * the commands that need this transform most are the folder ones, which have no note of their own, so
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
 * last had open" — and the reporter's own template (`<% TOKENS.rawString.replaceAll(": ", " - ") %>`) never
 * touches `tp.file.*` at all, which is the usual shape: Templater is the expression evaluator, and the file
 * it insists on is incidental. One chain shared by every call site is also why this is not a per-command
 * anchor (the folder merge offering one of its merged notes, a rename offering the folder note): that would
 * make the same template report a different `tp.file.title` depending on which command ran it.
 *
 * The fallback note is read, never written, so it is deliberately NOT filtered through `isPathIgnored` — this
 * module takes no settings, and a note excluded from being an operation's target is still a note.
 *
 * @param app - The app.
 * @param contextFile - The caller's own note, when it has one.
 * @returns The note to run the template against, or `null` when the vault has none.
 */
function resolveTemplaterContextFile(app: App, contextFile: null | TFile): null | TFile {
  // The active file is taken as it comes, `isMarkdownFile` unchecked: with a canvas focused it is what the
  // Run has always reported on, and narrowing that now would be a second, unasked-for change.
  return contextFile
    ?? app.workspace.getActiveFile()
    ?? resolveMostRecentlyOpenedNote(app)
    ?? resolveMostRecentlyModifiedNote(app);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
