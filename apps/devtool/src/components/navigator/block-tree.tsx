import { KindIndicator } from "@/components/shared/kind-indicator";

type BlockNode = {
  name: string;
  kind: string;
  children?: BlockNode[];
};

type BlockTreeProps = {
  blocks: BlockNode[];
  depth?: number;
};

export function BlockTree({ blocks, depth = 0 }: BlockTreeProps) {
  if (blocks.length === 0) {
    return <p className="px-2 py-0.5 text-[10px] text-slate-600 italic">No blocks defined</p>;
  }

  return (
    <div className="space-y-0.5">
      {blocks.map((block) => (
        <div key={block.name}>
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-slate-300"
            style={{ paddingLeft: `${(depth + 1) * 8}px` }}
          >
            <KindIndicator kind={block.kind} />
            <span className="truncate">{block.name}</span>
          </div>
          {block.children && block.children.length > 0 && (
            <BlockTree blocks={block.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}
