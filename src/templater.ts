import type {
  Plugin,
  TFile
} from 'obsidian';

declare module '@obsidian-typings/obsidian-public-latest' {
  interface PluginsPluginsRecord {
    ['templater-obsidian']?: TemplaterPlugin;
  }
}

/**
 * Templater's `RunMode.DynamicProcessor`, the mode for "parse this text and hand it back" — no file is
 * created, appended to or overwritten (issue #196).
 *
 * Spelled as a number rather than mirroring Templater's whole `RunMode` enum, because only this one member
 * is ever passed and a partial copy of someone else's enum rots silently. Templater's own numbering is
 * `CreateNewFromTemplate = 0 … DynamicProcessor = 4`.
 */
export const TEMPLATER_RUN_MODE_DYNAMIC_PROCESSOR = 4;

/**
 * Templater's `RunMode.OverwriteFile`, the mode a note being filled in from its own content runs under — the
 * mode Templater's `overwrite_file_commands` picks for itself.
 *
 * Spelled as a number for the same reason as {@link TEMPLATER_RUN_MODE_DYNAMIC_PROCESSOR}. Templater's own
 * numbering is `CreateNewFromTemplate = 0, AppendActiveFile = 1, OverwriteFile = 2 … DynamicProcessor = 4`.
 */
export const TEMPLATER_RUN_MODE_OVERWRITE_FILE = 2;

/**
 * The context object Templater threads through a template run. Built by
 * {@link TemplaterApi.create_running_config} and handed straight back to {@link TemplaterApi.parse_template};
 * this plugin never constructs one itself, so the shape is declared only so the two calls typecheck.
 *
 * `target_file` is what `tp.file.*` reports on, and it is read EAGERLY — `tp.file.title` resolves to
 * `target_file.basename` while the function object is being generated, not when the template calls it — so
 * a run without a real file throws. Confirmed against Templater 2.25.0: passing no target file fails with
 * `Cannot read properties of undefined (reading 'path')`, a message that says nothing about what the user
 * did wrong, which is why `applyNameTransform` refuses with its own message before getting here.
 */
export interface TemplaterRunningConfig {
  readonly active_file: null | TFile;
  readonly run_mode: number;
  readonly target_file: TFile;
  readonly template_file: TFile | undefined;
}

interface TemplaterApi {
  create_running_config(template_file: TFile | undefined, target_file: TFile, run_mode: number): TemplaterRunningConfig;

  /**
   * Closes the task {@link TemplaterApi.start_templater_task} opened. Once the last pending path is closed,
   * Templater fires `templater:all-templates-executed`, which is the ONLY thing that makes a template's
   * `tp.hooks.on_all_templates_executed(…)` callback run — so this must be reached even when the parse throws.
   */
  end_templater_task(path: string): Promise<void>;

  /**
   * Templater's own "render this note in place" entry point, used by the split/merge destination-file run,
   * which exposes no tokens and so has no prelude to position. `Create folder with notes...` deliberately
   * does NOT use it — it reads the note from disk, which would force the prelude into the file; see
   * `runTemplater` in `create-folder-with-notes-command-handler.ts`.
   */
  // eslint-disable-next-line unicorn/consistent-boolean-name -- `active_file` is Templater's own API parameter name.
  overwrite_file_commands(file: TFile, active_file?: boolean): Promise<void>;

  parse_template(config: TemplaterRunningConfig, template_content: string): Promise<string>;

  /**
   * Registers a path as having a template run in flight. Templater's own entry points bracket every run with
   * this and {@link TemplaterApi.end_templater_task}; a run that skips the pair parses fine but silently never
   * fires the `tp.hooks` callbacks.
   */
  start_templater_task(path: string): void;
}

interface TemplaterPlugin extends Plugin {
  templater: TemplaterApi;
}
