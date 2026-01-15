import type {
  App,
  HeadingCache
} from 'obsidian';
import type { Promisable } from 'type-fest';

import { parseMetadata } from 'obsidian-dev-utils/obsidian/MetadataCache';
import {
  trimEnd,
  trimStart
} from 'obsidian-dev-utils/String';

import type { InsertMode } from './Composers/ComposerBase.ts';

// eslint-disable-next-line no-magic-numbers -- Self-descriptive magic number.
export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface ParseHeadingNodeOptions {
  content: string;
  contentStartOffset: number;
  heading: string;
  headingEndIndex: number;
  headingsCaches: HeadingCache[];
  headingStartIndex: number;
  isFake: boolean;
  level: Level;
}

class MarkdownHeadingDocument {
  public constructor(private readonly frontmatter: string, private readonly node: MarkdownHeadingNode) {
    if (node.level !== 0) {
      throw new Error('Node level must be 0');
    }
  }

  public mergeWith(doc: MarkdownHeadingDocument, insertMode: InsertMode): MarkdownHeadingDocument {
    const mergedNode = insertMode === 'append' ? this.node.append(doc.node) : doc.node.append(this.node);
    return new MarkdownHeadingDocument(this.frontmatter, mergedNode);
  }

  public toString(): string {
    return this.frontmatter + this.node.toString();
  }

  public async wrapText(textFn: (text: string) => Promisable<string>): Promise<void> {
    await this.node.wrapText(textFn);
  }
}

class MarkdownHeadingNode {
  public readonly children: MarkdownHeadingNode[];

  public constructor(
    public readonly level: Level,
    public readonly heading: string,
    public text: string,
    children: MarkdownHeadingNode[],
    private readonly isFake = false
  ) {
    if (level === 0 && !isFake) {
      throw new Error('Root node must be fake');
    }

    if (children.some((child) => child.level !== level + 1)) {
      throw new Error('Child level must be exactly one level deeper than parent level');
    }

    this.children = children;
  }

  public append(doc: MarkdownHeadingNode): MarkdownHeadingNode {
    if (this.level !== doc.level) {
      throw new Error('Node level must be the same as the merging level');
    }

    if (this.heading !== doc.heading) {
      throw new Error('Node heading must be the same as the merging heading');
    }

    const childrenKeys = this.getChildrenKeys();
    const docChildrenKeys = doc.getChildrenKeys();

    const children: MarkdownHeadingNode[] = [...this.children];

    const keyIndexMap = new Map<string, number>();

    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (!child) {
        continue;
      }
      const key = childrenKeys.get(child) ?? '';
      keyIndexMap.set(key, index);
    }

    for (const child of doc.children) {
      const key = docChildrenKeys.get(child) ?? '';
      const index = keyIndexMap.get(key);
      if (index === undefined) {
        children.push(child);
        continue;
      }
      if (!children[index]) {
        continue;
      }
      children[index] = children[index].append(child);
    }

    const trimText = trimEnd(this.text, '\n');
    const trimDocText = trimStart(doc.text, '\n');

    const mergedText = trimText && trimDocText ? `${trimText}\n${trimDocText}` : trimText || trimDocText || '';

    return new MarkdownHeadingNode(this.level, this.heading, mergedText, children, this.isFake);
  }

  public toString(): string {
    let str = '';
    if (!this.isFake) {
      str += '#'.repeat(this.level);
      if (this.heading) {
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
  return new MarkdownHeadingDocument(frontmatter, headingNode);
}

function parseHeadingNode(options: ParseHeadingNodeOptions): MarkdownHeadingNode {
  const text = options.isFake && options.level > 0
    ? ''
    : options.content.slice(
      options.headingsCaches[options.headingStartIndex - 1]?.position.end.offset ?? options.contentStartOffset,
      options.headingsCaches[options.headingStartIndex]?.position.start.offset ?? options.content.length
    );

  const childrenLevelIndices = [];

  for (let i = options.headingStartIndex; i < options.headingEndIndex; i++) {
    if (options.headingsCaches[i]?.level === options.level + 1) {
      childrenLevelIndices.push(i);
    }
  }

  const children = [];

  if (options.headingStartIndex < options.headingEndIndex && childrenLevelIndices[0] !== options.headingStartIndex) {
    const child = parseHeadingNode({
      content: options.content,
      contentStartOffset: options.contentStartOffset,
      heading: '',
      headingEndIndex: childrenLevelIndices[0] ?? options.headingEndIndex,
      headingsCaches: options.headingsCaches,
      headingStartIndex: options.headingStartIndex,
      isFake: true,
      level: options.level + 1 as Level
    });
    children.push(child);
  }

  for (let j = 0; j < childrenLevelIndices.length; j++) {
    const headingStartIndex = childrenLevelIndices[j] ?? 0;
    const child = parseHeadingNode({
      content: options.content,
      contentStartOffset: options.contentStartOffset,
      heading: options.headingsCaches[headingStartIndex]?.heading ?? '',
      headingEndIndex: childrenLevelIndices[j + 1] ?? options.headingEndIndex,
      headingsCaches: options.headingsCaches,
      headingStartIndex: headingStartIndex + 1,
      isFake: false,
      level: options.level + 1 as Level
    });
    children.push(child);
  }

  return new MarkdownHeadingNode(options.level, options.heading, text, children, options.isFake);
}
