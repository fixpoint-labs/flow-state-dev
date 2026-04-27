"use client";

import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { File, FileCode2, FileText, Image, Package } from "lucide-react";

import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/flow-state/file-tree";

type ArtifactSummary = { id: string; title: string; extension?: string | null };

interface ArtifactPanelProps {
  artifacts: ArtifactSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Extension-based icon selection
// ---------------------------------------------------------------------------

const MD_EXTS = new Set(["md", "mdx"]);
const CODE_EXTS = new Set([
  "jsx", "tsx", "ts", "js", "py", "sh", "json", "css", "html",
  "yaml", "yml", "go", "rs", "java", "c", "cpp", "rb", "php",
  "swift", "kt", "sql", "xml", "toml", "scss", "svg",
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp"]);

/** Infer extension from filename, falling back to the stored extension. */
function inferExtension(title: string, storedExtension?: string | null): string | null {
  // Title takes priority over the stored extension so renames (e.g. `.txt`
  // → `.md`) are reflected in the file-tree icon immediately.
  const dot = title.lastIndexOf(".");
  if (dot !== -1 && dot !== title.length - 1) {
    return title.slice(dot + 1).toLowerCase();
  }
  return storedExtension ? storedExtension.toLowerCase() : null;
}

function getFileIcon(extension: string | null | undefined) {
  if (!extension) return FileText;
  const ext = extension.toLowerCase();
  if (MD_EXTS.has(ext)) return FileText;
  if (IMAGE_EXTS.has(ext)) return Image;
  if (CODE_EXTS.has(ext)) return FileCode2;
  return File;
}

// ---------------------------------------------------------------------------
// Tree builder — groups artifacts by directory path
// ---------------------------------------------------------------------------

interface FileNode {
  type: "file";
  artifact: ArtifactSummary;
  name: string;
}

interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

type TreeNode = FileNode | FolderNode;

/** Build a tree from flat artifact titles, treating `/` as path separators. */
function buildTree(artifacts: ArtifactSummary[]): TreeNode[] {
  const root = new Map<string, FolderNode>();
  const rootFiles: FileNode[] = [];

  for (const artifact of artifacts) {
    const parts = artifact.title.split("/");
    if (parts.length === 1) {
      rootFiles.push({ type: "file", artifact, name: artifact.title });
      continue;
    }

    const fileName = parts.pop()!;
    let currentMap = root;
    let currentPath = "";

    for (const dir of parts) {
      currentPath = currentPath ? `${currentPath}/${dir}` : dir;
      if (!currentMap.has(dir)) {
        const folder: FolderNode = { type: "folder", name: dir, path: currentPath, children: [] };
        currentMap.set(dir, folder);
      }
      const folder = currentMap.get(dir)!;
      // Use a sub-map for the next level (stored on the folder node temporarily)
      if (!(folder as any)._childMap) {
        (folder as any)._childMap = new Map<string, FolderNode>();
      }
      currentMap = (folder as any)._childMap;
    }

    // Add file to the deepest folder
    const deepestFolder = findFolder(root, parts);
    if (deepestFolder) {
      deepestFolder.children.push({ type: "file", artifact, name: fileName });
    }
  }

  // Flatten the map structure into the tree
  const result: TreeNode[] = [];
  flattenMap(root, result);
  result.push(...rootFiles);
  sortTree(result);
  return result;
}

function findFolder(map: Map<string, FolderNode>, parts: string[]): FolderNode | null {
  let current = map;
  let folder: FolderNode | null = null;
  for (const part of parts) {
    folder = current.get(part) ?? null;
    if (!folder) return null;
    current = (folder as any)._childMap ?? new Map();
  }
  return folder;
}

function flattenMap(map: Map<string, FolderNode>, result: TreeNode[]) {
  for (const folder of map.values()) {
    const childMap: Map<string, FolderNode> | undefined = (folder as any)._childMap;
    if (childMap) {
      flattenMap(childMap, folder.children);
      delete (folder as any)._childMap;
    }
    result.push(folder);
  }
}

/** Sort tree nodes: folders first (alphabetical), then files (alphabetical). */
function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.type === "folder") {
      sortTree(node.children);
    }
  }
}

// ---------------------------------------------------------------------------
// Tree renderer
// ---------------------------------------------------------------------------

function TreeNodes({ nodes, onSelect }: { nodes: TreeNode[]; onSelect?: (id: string) => void }) {
  return (
    <>
      {nodes.map((node) => {
        if (node.type === "folder") {
          return (
            <FileTreeFolder key={node.path} path={node.path} name={node.name}>
              <TreeNodes nodes={node.children} onSelect={onSelect} />
            </FileTreeFolder>
          );
        }
        const ext = inferExtension(node.artifact.title, node.artifact.extension);
        const Icon = getFileIcon(ext);
        return (
          <FileTreeFile
            key={node.artifact.id}
            path={node.artifact.id}
            name={node.name}
            icon={<Icon className="h-4 w-4 text-muted-foreground" />}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtifactPanel({ artifacts, selectedId, onSelect, className, style }: ArtifactPanelProps) {
  const tree = useMemo(() => buildTree(artifacts), [artifacts]);

  // Default all folders expanded so the tree is fully visible on load.
  const defaultExpanded = useMemo(() => {
    const paths = new Set<string>();
    function collect(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.type === "folder") {
          paths.add(node.path);
          collect(node.children);
        }
      }
    }
    collect(tree);
    return paths;
  }, [tree]);

  return (
    <aside className={cn("flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-l bg-muted/30", className)} style={style}>
      <div className="flex items-center gap-2 px-4 py-3">
        <Package className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Artifacts</span>
        {artifacts.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {artifacts.length}
          </Badge>
        )}
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1 p-2">
        {artifacts.length > 0 ? (
          <FileTree
            selectedPath={selectedId ?? null}
            onSelect={(path) => onSelect?.(path)}
            defaultExpanded={defaultExpanded}
          >
            <TreeNodes nodes={tree} onSelect={onSelect} />
          </FileTree>
        ) : (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No artifacts created yet. Ask the assistant to create or modify project artifacts.
          </p>
        )}
      </ScrollArea>
    </aside>
  );
}
