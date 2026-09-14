
export const MAX_FOLDER_DEPTH = 5;

const MAX_HOPS = 64;

/** @typedef {{id: number, name?: string, parent_id?: number|null}} Folder */

function childrenByParent(folders) {
  const map = new Map();
  for (const folder of folders) {
    if (folder.parent_id == null) continue;
    if (!map.has(folder.parent_id)) map.set(folder.parent_id, []);
    map.get(folder.parent_id).push(folder);
  }
  return map;
}

export function subtreeIds(folders, folderId) {
  const children = childrenByParent(folders);
  const seen = new Set([folderId]);
  const queue = [folderId];
  while (queue.length) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child.id);
    }
  }
  return seen;
}

export function folderPath(folders, folderId) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain = [];
  let current = folderId;
  for (let hops = 0; byId.has(current) && hops < MAX_HOPS; hops += 1) {
    const folder = byId.get(current);
    chain.unshift(folder);
    current = folder.parent_id;
  }
  return chain;
}

export function subtreeHeight(folders, folderId) {
  const children = childrenByParent(folders);
  let height = 0;
  let level = [folderId];
  const seen = new Set(level);
  while (level.length && height < MAX_HOPS) {
    height += 1;
    const next = [];
    for (const id of level) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        next.push(child.id);
      }
    }
    level = next;
  }
  return Math.max(height, 1);
}

export function folderMoveIssue(folders, folderId, parentId) {
  if (parentId == null) return null;
  if (folderId != null && parentId === folderId) return 'self';
  if (!folders.some((f) => f.id === parentId)) return 'missing-parent';

  if (folderId != null && folderPath(folders, parentId).some((f) => f.id === folderId)) {
    return 'descendant';
  }

  const parentDepth = folderPath(folders, parentId).length;
  const height = folderId == null ? 1 : subtreeHeight(folders, folderId);
  if (parentDepth + height > MAX_FOLDER_DEPTH) return 'too-deep';
  return null;
}

export function buildFolderTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, { folder: f, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.folder.parent_id != null ? byId.get(node.folder.parent_id) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function flattenFolderTree(folders, { expanded = null } = {}) {
  const rows = [];
  const walk = (nodes, depth) => {
    if (depth > MAX_HOPS) return;
    for (const node of nodes) {
      rows.push({ ...node, depth });
      if (expanded === null || expanded.has(node.folder.id)) walk(node.children, depth + 1);
    }
  };
  walk(buildFolderTree(folders), 0);
  return rows;
}
