/**
 * The arrangements the page lays workbenches out in, from the blocks their plugins declare (openfilm.json `blocks`,
 * src/plugin-blocks.mjs): for each workbench that declares blocks, its own (by id) and those it borrows from another
 * workbench (by `owner:id`, as that one declares them). A workbench that names another's (`"blocks": "edit"`: Motion)
 * is laid out in that one's arrangement; one that declares none takes the panes' place whole (components/surfaces).
 */
import type { BlockDecl } from '../../../../src/plugin-blocks.mjs';
import type { ArrangementSpec, BlockSpec } from './workspaces.ts';

/** What of a plugin this reads: its workbench and the blocks it declares (lib/plugins Plugin). */
export interface WithBlocks { workbench?: string; blocks?: string | readonly (BlockDecl | string)[] }

const specOf = (owner: string, decl: BlockDecl, key: string): BlockSpec => {
  const min = decl.min ?? [240, 180];
  const sideways = decl.edge === 'left' || decl.edge === 'right';
  return {
    key, owner, id: decl.id, ...(decl.title ? { title: decl.title } : {}), edge: decl.edge, size: decl.size ?? null, open: decl.open !== false,
    min, range: decl.range ?? [sideways ? min[0] : min[1], 1600],
  };
};

const made = new WeakMap<readonly WithBlocks[], ReadonlyMap<string, ArrangementSpec>>();

/** Each workbench's arrangement, by its name: its blocks in the order declared (a borrowed one whose workbench is not listed is left out). */
export function arrangementSpecs(plugins: readonly WithBlocks[]): ReadonlyMap<string, ArrangementSpec> {
  const known = made.get(plugins);
  if (known) return known;
  const declared = new Map<string, readonly (BlockDecl | string)[]>();
  for (const p of plugins) if (p.workbench && Array.isArray(p.blocks) && !declared.has(p.workbench)) declared.set(p.workbench, p.blocks);
  const own = (owner: string, id: string) => declared.get(owner)?.find((b): b is BlockDecl => typeof b === 'object' && b.id === id);
  const out = new Map<string, ArrangementSpec>();
  for (const [name, blocks] of declared) {
    const specs = blocks.flatMap((entry): BlockSpec[] => {
      if (typeof entry === 'object') return [specOf(name, entry, entry.id)];
      const [owner, id] = entry.split(':') as [string, string];
      const decl = owner === name ? undefined : own(owner, id);
      return decl ? [specOf(owner, decl, entry)] : [];
    });
    /* one main block: the first that says so, else the first */
    const center = specs.find((b) => b.edge === 'center') ?? specs[0];
    if (center) out.set(name, { name, blocks: specs.map((b) => (b === center ? (b.edge === 'center' ? b : { ...b, edge: 'center' as const }) : b.edge === 'center' ? { ...b, edge: 'right' as const } : b)) });
  }
  made.set(plugins, out);
  return out;
}

/** The arrangement the workbench `workbench` is laid out in (its own, or the one it names); null: none, it takes the panes' place whole. */
export function arrangementOf(workbench: string, plugins: readonly WithBlocks[]): string | null {
  const blocks = plugins.find((p) => p.workbench === workbench)?.blocks;
  if (typeof blocks === 'string') return arrangementSpecs(plugins).has(blocks) ? blocks : null;
  return arrangementSpecs(plugins).has(workbench) ? workbench : null;
}

/** A block's words in `language` (else English, else its id). */
export const blockTitle = (block: BlockSpec, language: string): string => block.title?.[language] ?? block.title?.en ?? block.id;
