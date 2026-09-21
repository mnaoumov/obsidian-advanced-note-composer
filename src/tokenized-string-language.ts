/**
 * @file
 *
 * The Prism language id under which the plugin's note templates are highlighted.
 *
 * The grammar itself is `TemplatesLanguageComponent` in `obsidian-dev-utils`: the `{{token:format}}` syntax
 * is Obsidian core's own Templates language, shared by every plugin that extends it, so only the id and the
 * token vocabulary are this plugin's own.
 */

/**
 * The Prism language the settings tab's template fields are highlighted as.
 */
export const TOKENIZED_STRING_LANGUAGE = 'advanced-note-composer-template';
