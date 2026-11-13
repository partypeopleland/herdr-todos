export const WBS_LABEL = "工作拆解";

// Mutates a copy of the flat to-do list. A WBS assignment owns one direct
// child under its parent, before any existing children.
export function findWbsChild(items, parentIndex) {
  const parent = items[parentIndex];
  if (!parent) return -1;
  const depth = parent.depth ?? 0;
  let end = parentIndex + 1;
  while (end < items.length && (items[end].depth ?? 0) > depth) end++;
  for (let i = parentIndex + 1; i < end; i++) {
    if ((items[i].depth ?? 0) === depth + 1 && items[i].text === WBS_LABEL) return i;
  }
  return -1;
}

export function ensureWbsChild(items, parentIndex, updatedAt) {
  const parent = items[parentIndex];
  if (!parent) return null;
  const depth = parent.depth ?? 0;
  let index = findWbsChild(items, parentIndex);
  if (index < 0) {
    index = parentIndex + 1;
    items.splice(index, 0, { depth: depth + 1, text: WBS_LABEL, done: false, doing: true, due: null, doneOn: null, updatedAt });
    return { index, before: null, updatedAt };
  }
  const child = items[index];
  if (child.doing && !child.done) return { index, unchanged: true };
  items[index] = { ...child, done: false, doing: true, doneOn: null, updatedAt };
  return { index, before: child, updatedAt };
}

export function wbsPrompt({ parentText, due = "", target, todo }) {
  const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  return `Break this to-do into sub-tasks (a work breakdown). It's ${quote(parentText)}${due} in the ${target}.\n\nThe parent is Doing. The to-do panel has created or reused a direct child, "${WBS_LABEL}", for this breakdown; do not add a duplicate. The deliverable is the breakdown itself — new child items under the parent, not the work. If the parent has a note (the agreed plan), treat it as the spec.\n\nPropose the breakdown first and wait for my confirmation. Once I confirm, run \`${todo}\`, identify the intended parent by its position and note, then add each actual work item beneath its current number: \`${todo} add --under <parent number> "<sub-task>"\`. Recheck the number if the list changes. Keep each child a short one-liner; nest deeper levels the same way. Leave every new work item unchecked.\n\nWhen the breakdown is finished, run \`${todo}\` again and identify this parent's direct "${WBS_LABEL}" child by its indentation and item number; another parent may have a child with the same name. Tick only that child with \`${todo} done <child number>\`. Then return this parent to To-do with \`${todo} open <parent number>\`, using its number from the current list. Do not tick the parent or the new work items.`;
}
