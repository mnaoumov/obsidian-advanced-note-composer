import { stringifyYaml } from 'obsidian';

import type { Frontmatter } from './frontmatter-merge.ts';

import { extractFrontmatter } from './frontmatter-merge.ts';

/**
 * Parameters for {@link applyPropertiesWrittenDuringRun}.
 */
export interface ApplyPropertiesWrittenDuringRunParams {
  /**
   * The note as it stands once the template has run — including anything the template itself wrote.
   */
  readonly contentAfterRun: string;

  /**
   * The note as it stood before the template ran.
   */
  readonly contentBeforeRun: string;

  /**
   * What the template rendered to, derived from {@link ApplyPropertiesWrittenDuringRunParams.contentBeforeRun}
   * and therefore blind to anything written during the run.
   */
  readonly renderedContent: string;
}

/**
 * Keeps the properties a template wrote WHILE it ran, which the rendered content would otherwise erase.
 *
 * A template that calls `app.fileManager.processFrontMatter(tp.config.target_file, …)` writes the note
 * during its own run, but the render was computed from the note as it stood BEFORE that write — so writing
 * the render over the top silently reverts it. Templater's own answer is
 * `tp.hooks.on_all_templates_executed(…)`, which defers the write until after the render lands; this makes
 * the plain call work too, because this plugin owns the write and can see both versions.
 *
 * Only PROPERTIES are reconciled, and only where they actually changed: a key the template added or
 * changed is carried onto the render, a key it deleted is dropped from the render, and a key the render
 * itself produced survives untouched. Any other mid-run edit to the note (appending to the body, say) is
 * deliberately NOT preserved — the render is authoritative for the note's text, and a template that
 * rewrites its own body while rendering it has no coherent answer.
 *
 * @param params - The note before the run, after the run, and what it rendered to.
 * @returns The content to write.
 */
export function applyPropertiesWrittenDuringRun(params: ApplyPropertiesWrittenDuringRunParams): string {
  const {
    contentAfterRun,
    contentBeforeRun,
    renderedContent
  } = params;

  if (contentAfterRun === contentBeforeRun) {
    return renderedContent;
  }

  const propertiesBeforeRun = extractFrontmatter(contentBeforeRun).frontmatter;
  const propertiesAfterRun = extractFrontmatter(contentAfterRun).frontmatter;
  const rendered = extractFrontmatter(renderedContent);

  // Compared by serialization so a rewritten list or nested object counts as changed; the values come from
  // YAML, so they are plain data and always serializable.
  const changedEntries = Object.entries(propertiesAfterRun)
    .filter(([key, value]) => JSON.stringify(propertiesBeforeRun[key]) !== JSON.stringify(value));
  const removedKeys = new Set(Object.keys(propertiesBeforeRun).filter((key) => !Object.hasOwn(propertiesAfterRun, key)));

  if (changedEntries.length === 0 && removedKeys.size === 0) {
    return renderedContent;
  }

  const properties: Frontmatter = Object.fromEntries(
    Object.entries(rendered.frontmatter).filter(([key]) => !removedKeys.has(key))
  );
  for (const [key, value] of changedEntries) {
    properties[key] = value;
  }

  return Object.keys(properties).length > 0
    ? `---\n${stringifyYaml(properties)}---\n${rendered.content}`
    : rendered.content;
}
