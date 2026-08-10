import type {
  App,
  TFile
} from 'obsidian';

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
 * Parameters for {@link applyNameTransform}.
 */
export interface ApplyNameTransformParams {
  readonly app: App;

  /**
   * The note the Templater run reports on through `tp.file.*`, or `null` to fall back to the active note.
   *
   * Not optional decoration: Templater reads `target_file.basename` / `target_file.stat` EAGERLY while
   * building its function object, so a run with no file at all throws before the template is even parsed.
   * A flow that has an obvious note (a split's source) passes it; the rest fall back to whatever is open.
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

  const targetFile = contextFile ?? app.workspace.getActiveFile();
  if (!targetFile) {
    throw new NameTransformError('Name transform template uses Templater syntax, which needs an open note as its context');
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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
