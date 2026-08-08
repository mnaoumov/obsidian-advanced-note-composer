import { getMandatoryNamedGroup } from 'obsidian-dev-utils/reg-exp';

/**
 * The name template a section falls back to when its `{{file}}` marker names nothing — and the name the
 * implicit section gets when the template has no marker at all. Naming the note after its folder is what
 * issue #191 literally asks for, so the default content template (empty) already produces it.
 */
export const DEFAULT_NOTE_NAME_TEMPLATE = '{{safeFolderName}}';

/**
 * A `{{file}}` marker line: the token must be the first non-whitespace on its line, and everything after it
 * on that line is the file name.
 *
 * Anchoring to the line is what makes the whole design work. The name may itself contain tokens
 * (`{{file}} {{safeFolderName}}.md`), and a marker written as a token PARAMETER — `{{file:NAME}}` —
 * could not carry them, because `TEMPLATE_TOKEN_REG_EXP` is lazy and would stop at the inner `}}`.
 * A bare `{{file}}` plus "the rest of the line" nests nothing, so the existing token grammar is untouched.
 *
 * `{{file}}` anywhere else keeps its existing behavior: an unknown token key, which throws.
 */
const FILE_MARKER_LINE_REG_EXP = /^[ \t]*\{\{file\}\}(?<Name>.*)$/i;

/**
 * One file declared by the folder content template.
 */
export interface FolderContentTemplateSection {
  /**
   * The template for this file's content. Never resolved here — the caller resolves it once the folder's
   * final name is known.
   */
  readonly contentTemplate: string;

  /**
   * The template for this file's name, taken from the rest of its `{{file}}` line.
   */
  readonly nameTemplate: string;
}

/**
 * Splits the `createFolderContentTemplate` setting into the files it declares (issue #191).
 *
 * A line whose first non-whitespace is `{{file}}` starts a new file and names it with the rest of that line;
 * everything up to the next marker is that file's content.
 *
 * Two lenient rules, both deliberate — they make "no marker" a special case of the general rule rather than a
 * separate mode, and they mean no configuration can produce zero notes:
 *
 * - A template with NO marker is one file named {@link DEFAULT_NOTE_NAME_TEMPLATE}, holding the whole
 *   template. That is the default (empty) setting, and it is exactly the feature as originally requested.
 * - Non-blank text BEFORE the first marker becomes its own leading file, named the same way. Blank leading
 *   text is dropped instead, so putting the first marker on line 2 does not create an empty note.
 *
 * @param template - The `createFolderContentTemplate` setting, as typed.
 * @returns The declared files, in the order they appear. Never empty.
 */
export function parseFolderContentTemplate(template: string): readonly FolderContentTemplateSection[] {
  const sections: FolderContentTemplateSection[] = [];
  let nameTemplate = DEFAULT_NOTE_NAME_TEMPLATE;
  let contentLines: string[] = [];
  let hasSeenMarker = false;

  for (const line of template.split('\n')) {
    const markerMatch = FILE_MARKER_LINE_REG_EXP.exec(line);
    if (!markerMatch) {
      contentLines.push(line);
      continue;
    }

    // The text above the FIRST marker has no marker of its own, so it is only kept when it actually holds
    // Something — otherwise every template that starts with a blank line would grow a stray empty note.
    if (hasSeenMarker) {
      sections.push(buildSection(nameTemplate, contentLines));
    } else {
      if (contentLines.join('\n').trim()) {
        sections.push(buildSection(nameTemplate, contentLines));
      }
      hasSeenMarker = true;
    }

    nameTemplate = getMandatoryNamedGroup(markerMatch, 'Name').trim() || DEFAULT_NOTE_NAME_TEMPLATE;
    contentLines = [];
  }

  sections.push(buildSection(nameTemplate, contentLines));
  return sections;
}

/**
 * Builds one section, normalizing its content to end with exactly one newline when it holds anything.
 *
 * Without that, whether a file's content ends in a newline would depend on whether it happened to be the LAST
 * section (which keeps the template's trailing newline) or an inner one (whose trailing newline was consumed
 * as the next marker's line separator).
 *
 * @param nameTemplate - The name template for this section.
 * @param contentLines - The section's content, split into lines.
 * @returns The section.
 */
function buildSection(nameTemplate: string, contentLines: readonly string[]): FolderContentTemplateSection {
  const contentTemplate = contentLines.join('\n').replace(/\n*$/, '');
  return {
    contentTemplate: contentTemplate ? `${contentTemplate}\n` : '',
    nameTemplate
  };
}
