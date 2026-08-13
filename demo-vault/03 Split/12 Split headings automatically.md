# Split headings automatically

Heading-driven splits normally still ask you something: `Extract this heading...` opens the target
picker, and every split asks for confirmation. Turn this on and they just run — each new note named
after the heading it came from.

## Try it

1. Turn on **Should split headings automatically** in the plugin settings (under `Split/extract`).
2. Also turn on **Should split into folder** to get one folder per heading.
3. Put the cursor anywhere inside the `Beta` section below and run `Extract this heading...`. It
   splits immediately — no picker, no confirmation — into `Beta/Beta.md`.
4. Put the cursor in any remaining `##` section and run `Split note by headings - H2` instead: every
   `##` section left in this note is extracted in one go, each into its own heading-named folder —
   still without a single prompt.

It covers `Split note by headings - H1` through `H6`, their `content` variants, and
`Extract this heading...`.

Leave the setting off (the default) and these commands keep asking, as configured by **Should ask
before splitting**. That setting still governs ordinary splits, where you pick the target yourself,
whichever way this one is set.

## Alpha

The first section. Extracting it produces a note named `Alpha`.

## Beta

The second section. Extracting it produces a note named `Beta`.

## Gamma

The third section. Extracting it produces a note named `Gamma`.
