import type {
  App,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';

/**
 * Runs Templater over one note the way `Should run templater on destination file` runs it over a split or
 * merge destination: Templater's own `overwrite_file_commands`.
 */
export type DestinationTemplaterRunner = (file: TFile) => Promise<void>;

/**
 * Parameters for {@link resolveDestinationTemplaterRunner}.
 */
export interface ResolveDestinationTemplaterRunnerParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;

  /**
   * The `shouldRunTemplaterOnDestinationFile` setting.
   */
  readonly shouldRunTemplater: boolean;

  /**
   * Whether a missing Templater plugin is reported. Off for a flow whose composers have already said so
   * for the same run, so the user is not told twice.
   */
  readonly shouldWarnIfMissing: boolean;
}

/**
 * Decides ONCE per operation whether its produced notes are run through Templater, for the flows that write
 * the `Split template` outside a composer — the recursive split's deferred pass and
 * `Create empty note in folder...` (issue #284). Those flows used to skip Templater entirely, which left the
 * template's own `<% %>` commands raw in every note they produced, while an ordinary split honored them.
 *
 * Deciding once is what keeps a batch from repeating the "Templater is not installed" notice per note.
 *
 * @param params - The app, the notice sink and the setting.
 * @returns The runner, or `null` when the setting is off or Templater is not installed.
 */
export function resolveDestinationTemplaterRunner(params: ResolveDestinationTemplaterRunnerParams): DestinationTemplaterRunner | null {
  const {
    app,
    pluginNoticeComponent,
    shouldRunTemplater,
    shouldWarnIfMissing
  } = params;

  if (!shouldRunTemplater) {
    return null;
  }

  const templaterPlugin = app.plugins.plugins['templater-obsidian'];
  if (!templaterPlugin) {
    if (shouldWarnIfMissing) {
      pluginNoticeComponent.showNotice(createFragment((f) => {
        f.appendText('Advanced Note Composer: You have enabled setting ');
        appendCodeBlock(f, 'Should run templater on destination file');
        f.appendText(', but Templater plugin is not installed.');
      }));
    }
    return null;
  }

  return async (file) => {
    await templaterPlugin.templater.overwrite_file_commands(file, app.workspace.getActiveFile() === file);
  };
}
