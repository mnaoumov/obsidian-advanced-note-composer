/**
 * @file
 *
 * This plugin's whole public surface, as a consumer sees it. Both kinds of it live here, because a
 * consumer asking "what do I compile against?" should find one file rather than two:
 *
 * - **Replaced core methods.** The `Backlinks` and `Names` modules answer by REPLACING a method
 *   Obsidian already has — `app.metadataCache.getBacklinksForFile()` and
 *   `app.metadataCache.getLinkSuggestions()` — so a consumer that only wants the faster answer calls
 *   core and never reaches for a handle. {@link GetBacklinksForFileFn} and {@link GetLinkSuggestionsFn}
 *   declare the members those patched methods ALSO carry; every one of them is deprecated since
 *   `1.3.0` and goes away in `2.0.0`, because nothing of this plugin's own belongs on an Obsidian
 *   function. Each has a replacement on the published API below.
 * - **A published API.** {@link AdvancedMetadataCacheApi} is published through the plugin registry
 *   under the plugin id `advanced-metadata-cache` and carries a contract version of its own. It
 *   answers what the `Titles` and `Headings` modules know, which core has no method for, and since
 *   contract `1.3.0` every extra the `Backlinks` and `Names` modules offer beyond the core call.
 *
 * Hand-written and self-contained on purpose: it imports from `obsidian` and nothing else, so a
 * plugin that has never heard of `obsidian-dev-utils` can copy this file, or reference it, and depend
 * on this plugin with no build-time dependency on this repository at all.
 *
 * {@link CustomArrayDict} and {@link LinkSuggestion} are therefore INLINED rather than imported from
 * `@obsidian-typings/obsidian-public-latest`, where they are declared — structurally copied from
 * `@obsidian-typings/obsidian-public-1.13.7`. That trade was made deliberately: the drift cost is
 * bounded, since a structural copy stays assignable in both directions while upstream only adds
 * optional members, and a required addition is a change a consumer would have to handle anyway;
 * the import cost is not, since a stranger who wanted one interface would install a typings package
 * to get it. If a future member of this file cannot be inlined that cheaply, the file stops being
 * copyable, which is the property to protect first.
 */

import type {
  Reference,
  TFile
} from 'obsidian';

/**
 * This plugin's API, published through the `obsidian-dev-utils` plugin registry under the plugin id
 * `advanced-metadata-cache`.
 */
export interface AdvancedMetadataCacheApi {
  /**
   * Reads a note's backlinks from the `Backlinks` module's cache — the answer the patched
   * `app.metadataCache.getBacklinksForFile()` gives, reachable by path as well as by file.
   *
   * Fast, and possibly a moment behind a change Obsidian has not finished processing; use
   * {@link AdvancedMetadataCacheApi.getBacklinksForFileSafe} when the caller has just changed the vault.
   * Until the module has filled its cache, at startup, it answers with Obsidian's own implementation.
   *
   * Added in contract `1.3.0`, replacing the patched method called directly with a path.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The backlinks, keyed by the path of each linking note; empty for a path no note answers to.
   *   `null` while the `Backlinks` module is off — call core then.
   */
  getBacklinksForFile(pathOrFile: string | TFile): CustomArrayDict<Reference> | null;

  /**
   * Calls Obsidian's own `getBacklinksForFile()`, bypassing the `Backlinks` module's cache — to compare
   * against it, or to get an answer that cannot depend on this plugin at all.
   *
   * Added in contract `1.3.0`, replacing `getBacklinksForFile.originalFn`.
   *
   * @param file - The note.
   * @returns Obsidian's answer. Never `null`: with the module off, core IS the original.
   */
  getBacklinksForFileOriginal(file: TFile): CustomArrayDict<Reference>;

  /**
   * {@link AdvancedMetadataCacheApi.getBacklinksForFile}, waiting first for every change already
   * reported to the cache to be processed.
   *
   * Added in contract `1.3.0`, replacing `getBacklinksForFile.safe`.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The backlinks; `null` while the `Backlinks` module is off.
   */
  getBacklinksForFileSafe(pathOrFile: string | TFile): Promise<CustomArrayDict<Reference> | null>;

  /**
   * Reads when each of a note's headings was created, last modified and last seen.
   *
   * Obsidian keeps no per-heading metadata, so the `Headings` module keeps it: it compares each parse of
   * a note with the previous one to work out which heading is which, across renames, moves and level
   * changes, and stores the times in this plugin's own folder, never in the note. Synchronous, and current
   * as of the last parse Obsidian announced, so a caller that has just edited the note should await
   * `obsidian-dev-utils`' `getCacheSafe` (or the next `changed` event) first.
   *
   * The times are what this device saw: a change arriving from another device is stamped when it arrives
   * here. A time is `null` when the plugin did not see the event happen — a heading already
   * there when its note started being tracked has neither `created` nor `modified`. A sort should place
   * `null` as the oldest and keep document order among equals.
   *
   * Added in contract `1.2.0`.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The note's headings in document order. Empty for a path no note answers to, for a note with
   *   no headings, and while the `Headings` module is off.
   */
  getHeadingTimes(pathOrFile: string | TFile): HeadingTimes[];

  /**
   * Every link target the `[[` autocomplete can offer, answered from the `Names` module's index — the
   * answer the patched `app.metadataCache.getLinkSuggestions()` gives.
   *
   * Until the index is built, at startup, it answers with Obsidian's own implementation; use
   * {@link AdvancedMetadataCacheApi.getLinkSuggestionsSafe} to wait for the index instead.
   *
   * Added in contract `1.3.0`.
   *
   * @returns The link suggestions, Obsidian's own array entry for entry unless the user has switched on
   *   offering titles, which appends entries after it. `null` while the `Names` module is off — call
   *   core then.
   */
  getLinkSuggestions(): LinkSuggestion[] | null;

  /**
   * Calls Obsidian's own `getLinkSuggestions()`, bypassing the `Names` module's index — a full vault walk.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.originalFn`.
   *
   * @returns Obsidian's answer. Never `null`: with the module off, core IS the original.
   */
  getLinkSuggestionsOriginal(): LinkSuggestion[];

  /**
   * {@link AdvancedMetadataCacheApi.getLinkSuggestions}, waiting for the index to be built first.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.safe`.
   *
   * @returns The link suggestions; `null` while the `Names` module is off.
   */
  getLinkSuggestionsSafe(): Promise<LinkSuggestion[] | null>;

  /**
   * Finds every note that answers to a name — its basename, one of its `aliases`, or one of its titles.
   *
   * The answer is a LIST, because several notes may declare the same alias, and it is unranked and
   * complete: which of them the user meant is a question about the caller's context. Matched
   * case-insensitively and with runs of whitespace collapsed, as Obsidian resolves a wikilink.
   *
   * Answers from the index as it stands, which is empty until it is built at startup; use
   * {@link AdvancedMetadataCacheApi.getPathsByNameSafe} when you may be asked early.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.getPathsByName`.
   *
   * @param name - A basename, alias or title, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name; `null` while the `Names` module is
   *   off.
   */
  getPathsByName(name: string): null | string[];

  /**
   * {@link AdvancedMetadataCacheApi.getPathsByName}, waiting for the index to be built first.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.getPathsByNameSafe`.
   *
   * @param name - A basename, alias or title, in any casing and spacing.
   * @returns The vault-relative paths; `null` while the `Names` module is off.
   */
  getPathsByNameSafe(name: string): Promise<null | string[]>;

  /**
   * The frontmatter properties whose values currently count as a note's title.
   *
   * There to be READ rather than re-typed: the point of the setting living in this plugin is that a
   * consumer which also cares about titles does not ask its own user to name the property a second
   * time. Show this list, do not offer a setting of your own.
   *
   * A fresh array on each call, so writing to it changes nothing here.
   *
   * @returns The configured property names, in the order they were typed. **Empty while the `Titles`
   *   module is off**, which is the same answer as "none are configured" and is meant to be: either
   *   way there is nothing to read.
   */
  getTitlePropertyNames(): string[];

  /**
   * Reads one note's titles — the values of the properties {@link
   * AdvancedMetadataCacheApi.getTitlePropertyNames} names.
   *
   * Lazily memoized per file and kept current by the vault's own events, so asking repeatedly costs a
   * map lookup. Synchronous, and safe to call from a suggester's per-keystroke path, which is what it
   * is for.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns Its titles, exactly as they were typed, in the order the configured properties were
   *   typed, with repeats dropped case-insensitively. Empty for a note carrying none, for a path no
   *   file answers to, and while the `Titles` module is off.
   */
  getTitles(pathOrFile: string | TFile): string[];

  /**
   * Offers the user title properties another plugin used to own, and adds the ones they approve to
   * {@link AdvancedMetadataCacheApi.getTitlePropertyNames}.
   *
   * For a plugin that stops owning a title property of its own: it proposes the value it held, and this
   * plugin — which owns the list, and so owns the dialog — shows the user the proposed names next to the
   * current list and lets them approve, edit or decline. The proposed names are ADDED to the list rather
   * than replacing it, so a user who already has `title` keeps it. While the `Titles` module is off, the
   * dialog also offers to switch it on, since the names answer nothing until it is.
   *
   * Resolves only once the dialog is closed, and without one at all when there is nothing to change.
   * Proposals arriving together are shown one after another, never stacked.
   *
   * Added in contract `1.1.0`.
   *
   * @param params - The proposal.
   * @returns Whether the user applied it. On `false` nothing was written, and the offer should come back.
   */
  migrateSettings(params: MigrateSettingsParams): Promise<MigrateSettingsResult>;
}

/**
 * The settings another plugin may propose through {@link AdvancedMetadataCacheApi.migrateSettings}.
 *
 * Structurally the payload of `obsidian-dev-utils`'s `SettingsMigrationApi<TMigratableSettings>`, whose
 * envelope {@link MigrateSettingsParams} and {@link MigrateSettingsResult} restate here so this file keeps
 * importing from `obsidian` alone; the plugin's build checks the two stay assignable.
 */
export interface AdvancedMetadataCacheMigratableSettings {
  /**
   * Frontmatter properties to add to the title properties, e.g. `['subtitle']`.
   */
  readonly titlePropertyNames?: readonly string[];
}

/**
 * A dictionary mapping string keys to arrays of values — Obsidian's own return type for backlinks.
 *
 * Inlined from `@obsidian-typings/obsidian-public-1.13.7` so this file imports from `obsidian` alone;
 * it is structurally identical, so a consumer that does have the typings package can use either.
 *
 * @typeParam T - The type of the values.
 */
export interface CustomArrayDict<T> {
  /**
   * Internal map storing key-to-array mappings.
   */
  data: Map<string, T[]>;

  /**
   * Add a value to the array associated with the given key.
   *
   * @param key - The key.
   * @param value - The value to add.
   */
  add(key: string, value: T): void;

  /**
   * Remove all values for the given key.
   *
   * @param key - The key to clear.
   */
  clear(key: string): void;

  /**
   * Remove all keys and their values.
   */
  clearAll(): void;

  /**
   * Check whether the array for the given key contains the specified value.
   *
   * @param key - The key.
   * @param value - The value to check.
   * @returns Whether the value exists.
   */
  contains(key: string, value: T): boolean;

  /**
   * Get the total number of values across all keys.
   *
   * @returns Total value count.
   */
  count(): number;

  /**
   * Get the array of values for the given key, or `null` if not found.
   *
   * @param key - The key.
   * @returns Array of values, or `null`.
   */
  get(key: string): null | T[];

  /**
   * Get all keys in the dictionary.
   *
   * @returns Array of keys.
   */
  keys(): string[];

  /**
   * Remove a specific value from the array associated with the given key.
   *
   * @param key - The key.
   * @param value - The value to remove.
   */
  remove(key: string, value: T): void;
}

/**
 * Extended implementation of the `app.metadataCache.getBacklinksForFile` method from Obsidian,
 * present while the `Backlinks` module is on.
 *
 * Calling it with a path is deprecated since 1.3.0, and so is every member below: each has a
 * replacement on {@link AdvancedMetadataCacheApi}, and 2.0.0 removes them, leaving Obsidian's own
 * signature.
 */
export interface GetBacklinksForFileFn {
  /**
   * Fast implementation that might be inconsistent if the file changes are not processed yet.
   *
   * @param pathOrFile - The path or file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  (pathOrFile: string | TFile): CustomArrayDict<Reference>;

  /**
   * Original implementation from Obsidian.
   *
   * @deprecated Since 1.3.0, removed in 2.0.0. Use {@link AdvancedMetadataCacheApi.getBacklinksForFileOriginal}.
   * @param file - The file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  originalFn(file: TFile): CustomArrayDict<Reference>;

  /**
   * Safe asynchronous implementation that waits for the file changes to be processed.
   *
   * @deprecated Since 1.3.0, removed in 2.0.0. Use {@link AdvancedMetadataCacheApi.getBacklinksForFileSafe}.
   * @param pathOrFile - The path or file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  safe(pathOrFile: string | TFile): Promise<CustomArrayDict<Reference>>;
}

/**
 * Extended implementation of the `app.metadataCache.getLinkSuggestions` method from Obsidian,
 * present while the `Names` module is on.
 *
 * Every member below is deprecated since 1.3.0: each has a replacement on
 * {@link AdvancedMetadataCacheApi}, and 2.0.0 removes them, leaving Obsidian's own signature.
 */
export interface GetLinkSuggestionsFn {
  /**
   * Fast implementation, answered from the index rather than from a full vault walk. Until the
   * index has finished building it falls through to Obsidian's own implementation.
   *
   * @returns Every link target the `[[` autocomplete can offer.
   */
  (): LinkSuggestion[];

  /**
   * Finds every note that answers to a name — its basename, or one of its `aliases`.
   *
   * The answer is a LIST, because several notes may declare the same alias, and it is unranked and
   * complete: which of them the user meant is a question about the caller's context.
   *
   * @deprecated Since 1.3.0, removed in 2.0.0. Use {@link AdvancedMetadataCacheApi.getPathsByName}.
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name.
   */
  getPathsByName(name: string): string[];

  /**
   * Safe asynchronous implementation of {@link GetLinkSuggestionsFn.getPathsByName} that waits for
   * the index to be built.
   *
   * @deprecated Since 1.3.0, removed in 2.0.0. Use {@link AdvancedMetadataCacheApi.getPathsByNameSafe}.
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name.
   */
  getPathsByNameSafe(name: string): Promise<string[]>;

  /**
   * Original implementation from Obsidian.
   *
   * @deprecated Since 1.3.0, removed in 2.0.0. Use {@link AdvancedMetadataCacheApi.getLinkSuggestionsOriginal}.
   * @returns Every link target the `[[` autocomplete can offer.
   */
  originalFn(): LinkSuggestion[];

  /**
   * Safe asynchronous implementation that waits for the index to be built.
   *
   * @deprecated Since 1.3.0, removed in 2.0.0. Use {@link AdvancedMetadataCacheApi.getLinkSuggestionsSafe}.
   * @returns Every link target the `[[` autocomplete can offer.
   */
  safe(): Promise<LinkSuggestion[]>;
}

/**
 * One heading's times, as {@link AdvancedMetadataCacheApi.getHeadingTimes} reports them. Every time is a
 * Unix epoch in milliseconds.
 */
export interface HeadingTimes {
  /**
   * When the heading first appeared, or `null` when it was already there when its note started being
   * tracked.
   */
  readonly created: null | number;

  /**
   * The heading text, as the metadata cache reports it.
   */
  readonly heading: string;

  /**
   * The heading level, 1 to 6.
   */
  readonly level: number;

  /**
   * The zero-based line the heading was on at the last parse.
   */
  readonly line: number;

  /**
   * When the heading's section — its own line and everything under it, subheadings included — last
   * changed, or `null` when it has not changed since its note started being tracked. Moving the whole
   * section elsewhere in the note does not count as a change to it.
   */
  readonly modified: null | number;

  /**
   * When the heading's own section — up to the next heading of any level — was last on screen in the
   * active editor for at least one ~2 s dwell while the window had focus, or `null` when it has not
   * been. Reading view is not measured.
   */
  readonly seen: null | number;
}

/**
 * Parameters for {@link AdvancedMetadataCacheApi.migrateSettings}.
 */
export interface MigrateSettingsParams {
  /**
   * The values the proposing plugin offers.
   */
  readonly proposedSettings: AdvancedMetadataCacheMigratableSettings;

  /**
   * The `manifest.id` of the plugin making the proposal, so the dialog can say whose settings these are.
   */
  readonly sourcePluginId: string;
}

/**
 * The outcome of {@link AdvancedMetadataCacheApi.migrateSettings}.
 */
export interface MigrateSettingsResult {
  /**
   * Whether the user approved the migration. `false` means they cancelled and nothing was written, so the
   * proposing plugin must NOT record the migration as done.
   */
  readonly isApplied: boolean;
}

/**
 * A link target the `[[` autocomplete can offer — Obsidian's own entry type.
 *
 * Inlined from `@obsidian-typings/obsidian-public-1.13.7` (where it is `LinkSuggestion extends
 * FileSuggestion`, flattened here so this file declares one interface rather than two) so this file
 * imports from `obsidian` alone; it is structurally identical, so a consumer that does have the
 * typings package can use either.
 */
export interface LinkSuggestion {
  /**
   * Resolved link note alias.
   */
  alias?: string;

  /**
   * The file.
   */
  file: null | TFile;

  /**
   * The path.
   */
  path: string;
}
