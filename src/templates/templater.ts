/**
 * @file
 *
 * Typed access to the `Templater` internals this plugin calls, through `@mnaoumov/obsidian-lib`'s third-party
 * plugin adapters rather than a hand `app.plugins` read.
 *
 * The library's `TEMPLATER_PLUGIN_ADAPTER` verifies only the members the library itself calls
 * (`create_running_config`, `read_and_parse_template`, `functions_generator`). This plugin also drives
 * `parse_template`, `overwrite_file_commands`, the `start_templater_task` / `end_templater_task` pair and the
 * plugin's `editor_handler`, so {@link TEMPLATER_PLUGIN_API_ADAPTER} delegates to the library's adapter and then
 * verifies those members too. A `Templater` missing any of them reads as "not available", never as a
 * `Cannot read properties of undefined` from inside a run.
 */

import type { ThirdPartyPluginAdapter } from '@mnaoumov/obsidian-lib/plugin/third-party-plugin';
import type {
  TemplaterApi as LibTemplaterApi,
  TemplaterRunningConfig
} from '@mnaoumov/obsidian-lib/templater';
import type {
  App,
  Plugin,
  TFile
} from 'obsidian';

import { getThirdPartyPluginApi } from '@mnaoumov/obsidian-lib/plugin/third-party-plugin';
import { TEMPLATER_PLUGIN_ADAPTER } from '@mnaoumov/obsidian-lib/templater';

/**
 * The `templater` object of the `Templater` plugin, widened to the members this plugin calls.
 *
 * Members are `snake_case` because `Templater`'s are.
 */
export interface TemplaterApi extends LibTemplaterApi {
  /**
   * Closes the task {@link TemplaterApi.start_templater_task} opened. Once the last pending path is closed,
   * `Templater` fires `templater:all-templates-executed`, which is the ONLY thing that makes a template's
   * `tp.hooks.on_all_templates_executed(…)` callback run — so this must be reached even when the parse throws.
   */
  readonly end_templater_task: (path: string) => Promise<void>;

  /**
   * `Templater`'s own "render this note in place" entry point, used by the split/merge destination-file run,
   * which exposes no tokens and so has no prelude to position. `Create folder with notes...` deliberately
   * does NOT use it — it reads the note from disk, which would force the prelude into the file; see
   * `runTemplater` in `create-folder-with-notes-command-handler.ts`.
   */
  // eslint-disable-next-line unicorn/consistent-boolean-name -- `active_file` is `Templater`'s own API parameter name.
  readonly overwrite_file_commands: (file: TFile, active_file?: boolean) => Promise<void>;

  /**
   * Renders the given template text against a running config and returns the result.
   *
   * `target_file` in the config is what `tp.file.*` reports on, and it is read EAGERLY — `tp.file.title`
   * resolves to `target_file.basename` while the function object is being generated — so a run without a real
   * file throws `Cannot read properties of undefined (reading 'path')` (confirmed against `Templater` 2.25.0).
   */
  readonly parse_template: (config: TemplaterRunningConfig, template_content: string) => Promise<string>;

  /**
   * Registers a path as having a template run in flight. `Templater`'s own entry points bracket every run with
   * this and {@link TemplaterApi.end_templater_task}; a run that skips the pair parses fine but silently never
   * fires the `tp.hooks` callbacks.
   */
  readonly start_templater_task: (path: string) => void;
}

/**
 * The `editor_handler` of the `Templater` plugin.
 */
export interface TemplaterEditorHandler {
  /**
   * Consumes the next `tp.file.cursor()` marker in the ACTIVE editor and puts the caret there. With a file, it
   * does nothing unless that file is the active one; with `shouldAutoJump` set, it does nothing when `Templater`'s
   * own `Automatic jump to cursor` setting is off — the pair `Templater` passes after rendering a note itself.
   */
  readonly jump_to_next_cursor_location: (file?: null | TFile, shouldAutoJump?: boolean) => Promise<void>;
}

/**
 * Everything this plugin reads off a running `Templater` instance.
 */
export interface TemplaterPluginApi {
  /**
   * The plugin's editor handler.
   */
  readonly editorHandler: TemplaterEditorHandler;

  /**
   * The plugin's `templater` object.
   */
  readonly templater: TemplaterApi;
}

/**
 * The adapter for the `Templater` plugin, verifying every member this plugin calls.
 */
export const TEMPLATER_PLUGIN_API_ADAPTER: ThirdPartyPluginAdapter<TemplaterPluginApi> = {
  getApi: getTemplaterPluginApiFromPlugin,
  pluginId: TEMPLATER_PLUGIN_ADAPTER.pluginId,
  pluginName: TEMPLATER_PLUGIN_ADAPTER.pluginName
};

/**
 * Returns the `Templater` API when the plugin is available and has the shape this plugin calls, else `null`.
 *
 * @param app - The Obsidian app instance.
 * @returns The API, or `null` when `Templater` is not available.
 */
export function getTemplaterPluginApi(app: App): null | TemplaterPluginApi {
  return getThirdPartyPluginApi({ adapter: TEMPLATER_PLUGIN_API_ADAPTER, app });
}

function getTemplaterPluginApiFromPlugin(plugin: Plugin): null | TemplaterPluginApi {
  const libTemplater = TEMPLATER_PLUGIN_ADAPTER.getApi(plugin);
  if (!libTemplater || !isTemplaterApi(libTemplater) || !('editor_handler' in plugin)) {
    return null;
  }
  const editorHandler = plugin.editor_handler;
  return isTemplaterEditorHandler(editorHandler) ? { editorHandler, templater: libTemplater } : null;
}

function isTemplaterApi(value: LibTemplaterApi): value is TemplaterApi {
  return 'end_templater_task' in value && typeof value.end_templater_task === 'function'
    && 'overwrite_file_commands' in value && typeof value.overwrite_file_commands === 'function'
    && 'parse_template' in value && typeof value.parse_template === 'function'
    && 'start_templater_task' in value && typeof value.start_templater_task === 'function';
}

function isTemplaterEditorHandler(value: unknown): value is TemplaterEditorHandler {
  return typeof value === 'object' && value !== null && 'jump_to_next_cursor_location' in value
    && typeof value.jump_to_next_cursor_location === 'function';
}
