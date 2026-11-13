import type { Options } from 'react-markdown';
import type { Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

function renderFrontmatter() {
  return (tree: Root) => {
    tree.children = tree.children.map((node) =>
      node.type === 'yaml'
        ? { type: 'code', lang: 'yaml', value: node.value, position: node.position }
        : node,
    );
  };
}

export const markdownOptions = {
  remarkPlugins: [remarkGfm, remarkFrontmatter, renderFrontmatter],
  rehypePlugins: [[rehypeHighlight, { plainText: ['mermaid'] }]],
} satisfies Pick<Options, 'remarkPlugins' | 'rehypePlugins'>;
