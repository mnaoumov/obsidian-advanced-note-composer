import type {
  App,
  HeadingCache
} from 'obsidian';
import type { Promisable } from 'type-fest';

import { parseMetadata } from 'obsidian-dev-utils/obsidian/metadata-cache';
import {
  trimEnd,
  trimStart
} from 'obsidian-dev-utils/string';

import { InsertMode } from './insert-mode.ts';

// eslint-disable-next-line no-magic-numbers -- Self-descriptive magic number.
export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface MarkdownHeadingDocumentConstructorParams {
  readonly frontmatter: string;
  readonly node: MarkdownHeadingNode;
}

interface MarkdownHeadingNodeConstructorParams {
  readonly children: MarkdownHeadingNode[];
  readonly heading: string;
  readonly isFake: boolean;
  readonly level: Level;
  readonly text: string;
}

interface ParseHeadingNodeParams {
  readonly content: string;
  readonly contentStartOffset: number;
  readonly heading: string;
  readonly headingEndIndex: number;
  readonly headingsCaches: HeadingCache[];
  readonly headingStartIndex: number;
  readonly isFake: boolean;
  readonly level: Level;
}

class MarkdownHeadingNode {
  public readonly level: Level;
  private readonly children: MarkdownHeadingNode[];
  private readonly heading: string;
  private readonly isFake: boolean = false;
  private text: string;

  public constructor(params: MarkdownHeadingNodeConstructorParams) {
    this.level = params.level;
    this.heading = params.heading;
    this.text = params.text;
    this.children = params.children;
    this.isFake = params.isFake;

    /* v8 ignore start -- defensive invariant: only parseHeadingNode creates nodes with correct levels. */
    if (this.level === 0 && !this.isFake) {
      throw new Error('Root node must be fake');
    }

    if (this.children.some((child) => child.level !== this.level + 1)) {
      throw new Error('Child level must be exactly one level deeper than parent level');
    }
    /* v8 ignore stop */
  }

  public append(doc: MarkdownHeadingNode): MarkdownHeadingNode {
    /* v8 ignore start -- defensive invariant: append is only called on nodes matched by heading key. */
    if (this.level !== doc.level) {
      throw new Error('Node level must be the same as the merging level');
    }

    if (this.heading !== doc.heading) {
      throw new Error('Node heading must be the same as the merging heading');
    }
    /* v8 ignore stop */

    const childrenKeys = this.getChildrenKeys();
    const docChildrenKeys = doc.getChildrenKeys();

    const children: MarkdownHeadingNode[] = [...this.children];

    const keyIndexMap = new Map<string, number>();

    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      /* v8 ignore start -- children is spread from this.children, elements are never undefined. */
      if (!child) {
        continue;
      }
      /* v8 ignore stop */
      /* v8 ignore start -- childrenKeys always has entries for all children. */
      const key = childrenKeys.get(child) ?? '';
      /* v8 ignore stop */
      keyIndexMap.set(key, index);
    }

    for (const child of doc.children) {
      /* v8 ignore start -- docChildrenKeys always has entries for all children. */
      const key = docChildrenKeys.get(child) ?? '';
      /* v8 ignore stop */
      const index = keyIndexMap.get(key);
      if (index === undefined) {
        children.push(child);
        continue;
      }
      /* v8 ignore start -- index is from keyIndexMap which was built from valid indices. */
      if (!children[index]) {
        continue;
      }
      /* v8 ignore stop */
      children[index] = children[index].append(child);
    }

    const trimText = trimEnd(this.text, '\n');
    const trimDocText = trimStart(doc.text, '\n');

    const mergedText = trimText && trimDocText ? `${trimText}\n${trimDocText}` : trimText || trimDocText || '';

    return new MarkdownHeadingNode({
      children,
      heading: this.heading,
      isFake: this.isFake,
      level: this.level,
      text: mergedText
    });
  }

  public toString(): string {
    let str = '';
    if (!this.isFake) {
      str += '#'.repeat(this.level);
      /* v8 ignore start -- heading is always set for non-fake nodes. */
      if (this.heading) {
        /* v8 ignore stop */
        str += ` ${this.heading}`;
      }
    }
    str += this.text;
    for (const child of this.children) {
      str += child.toString();
    }
    return str;
  }

  public async wrapText(textFn: (text: string) => Promisable<string>): Promise<void> {
    this.text = await textFn(this.text);
    for (const child of this.children) {
      await child.wrapText(textFn);
    }
  }

  private getChildrenKeys(): Map<MarkdownHeadingNode, string> {
    const headingCounts = new Map<string, number>();
    const childrenKeys = new Map<MarkdownHeadingNode, string>();

    for (const child of this.children) {
      const index = (headingCounts.get(child.heading) ?? 0) + 1;
      headingCounts.set(child.heading, index);
      childrenKeys.set(child, `${child.heading}\n${String(index)}`);
    }

    return childrenKeys;
  }
}

class MarkdownHeadingDocument {
  private readonly frontmatter: string;
  private readonly node: MarkdownHeadingNode;

  public constructor(params: MarkdownHeadingDocumentConstructorParams) {
    this.frontmatter = params.frontmatter;
    this.node = params.node;

    /* v8 ignore start -- defensive invariant: parseMarkdownHeadingDocument always creates root with level 0. */
    if (this.node.level !== 0) {
      throw new Error('Node level must be 0');
    }
    /* v8 ignore stop */
  }

  public mergeWith(doc: MarkdownHeadingDocument, insertMode: InsertMode): MarkdownHeadingDocument {
    const mergedNode = insertMode === InsertMode.Append ? this.node.append(doc.node) : doc.node.append(this.node);
    return new MarkdownHeadingDocument({
      frontmatter: this.frontmatter,
      node: mergedNode
    });
  }

  public toString(): string {
    return this.frontmatter + this.node.toString();
  }

  public async wrapText(textFn: (text: string) => Promisable<string>): Promise<void> {
    await this.node.wrapText(textFn);
  }
}

export async function parseMarkdownHeadingDocument(app: App, content: string): Promise<MarkdownHeadingDocument> {
  const metadata = await parseMetadata(app, content);
  const contentStartOffset = metadata.frontmatterPosition?.end.offset ?? 0;
  const frontmatter = content.slice(0, contentStartOffset);

  metadata.headings ??= [];
  metadata.headings.sort((a, b) => a.position.start.offset - b.position.start.offset);

  const headingNode = parseHeadingNode({
    content,
    contentStartOffset,
    heading: '',
    headingEndIndex: metadata.headings.length,
    headingsCaches: metadata.headings,
    headingStartIndex: 0,
    isFake: true,
    level: 0
  });
  return new MarkdownHeadingDocument({
    frontmatter,
    node: headingNode
  });
}

function parseHeadingNode(params: ParseHeadingNodeParams): MarkdownHeadingNode {
  const text = params.isFake && params.level > 0
    ? ''
    : params.content.slice(
      params.headingsCaches[params.headingStartIndex - 1]?.position.end.offset ?? params.contentStartOffset,
      params.headingsCaches[params.headingStartIndex]?.position.start.offset ?? params.content.length
    );

  const childrenLevelIndices = [];

  for (let i = params.headingStartIndex; i < params.headingEndIndex; i++) {
    if (params.headingsCaches[i]?.level === params.level + 1) {
      childrenLevelIndices.push(i);
    }
  }

  const children = [];

  if (params.headingStartIndex < params.headingEndIndex && childrenLevelIndices[0] !== params.headingStartIndex) {
    const child = parseHeadingNode({
      content: params.content,
      contentStartOffset: params.contentStartOffset,
      heading: '',
      headingEndIndex: childrenLevelIndices[0] ?? params.headingEndIndex,
      headingsCaches: params.headingsCaches,
      headingStartIndex: params.headingStartIndex,
      isFake: true,
      level: params.level + 1 as Level
    });
    children.push(child);
  }

  for (let j = 0; j < childrenLevelIndices.length; j++) {
    /* v8 ignore start -- defensive ?? on array indexing and optional heading property. */
    const headingStartIndex = childrenLevelIndices[j] ?? 0;
    const child = parseHeadingNode({
      content: params.content,
      contentStartOffset: params.contentStartOffset,
      heading: params.headingsCaches[headingStartIndex]?.heading ?? '',
      headingEndIndex: childrenLevelIndices[j + 1] ?? params.headingEndIndex,
      /* v8 ignore stop */
      headingsCaches: params.headingsCaches,
      headingStartIndex: headingStartIndex + 1,
      isFake: false,
      level: params.level + 1 as Level
    });
    children.push(child);
  }

  return new MarkdownHeadingNode({
    ...params,
    children,
    text
  });
}
