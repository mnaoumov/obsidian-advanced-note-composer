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

  // eslint-disable-next-line unicorn/consistent-boolean-name -- `active_file` is Templater's own API parameter name.
  overwrite_file_commands(file: TFile, active_file?: boolean): Promise<void>;

  parse_template(config: TemplaterRunningConfig, template_content: string): Promise<string>;
}

interface TemplaterPlugin extends Plugin {
  templater: TemplaterApi;
}
