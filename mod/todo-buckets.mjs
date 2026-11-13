// A Doing parent keeps its descendants in the same panel section while their
// own checkbox states remain independent.
export function bucketItems(items) {
  const stack = [];
  return items.map((x) => {
    const depth = x.depth ?? 0;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const underDoing = (stack[stack.length - 1]?.underDoing ?? false) || (x.doing && !x.done);
    stack.push({ depth, underDoing });
    return underDoing ? "doing" : x.done ? "done" : "todo";
  });
}
