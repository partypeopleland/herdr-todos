import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { WBS_LABEL, findWbsChild, ensureWbsChild, wbsPrompt } from "../mod/wbs-flow.mjs";
import { bucketItems } from "../mod/todo-buckets.mjs";

const root = resolve(import.meta.dirname, "..");
const startedAt = "2026-11-13 12:00";
const open = (text, depth = 0) => ({ text, depth, done: false, doing: false, doneOn: null, updatedAt: null });

// Load the actual View class without starting Herdr. Its methods use the same
// WBS helper as the installed mod; the context replaces only host APIs.
function modelHarness({ sendCode = 0, runError = null } = {}) {
  const calls = { sends: [], runs: [], notifications: [], pending: [] };
  const source = readFileSync(join(root, "mod/main.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export default class Todos", "class Todos");
  const context = vm.createContext({
    View: class {}, WBS_LABEL, findWbsChild, ensureWbsChild, wbsPrompt,
    home: () => "/home/test", appHome: () => "/app", shared: () => ({}),
    hc: async (args) => { calls.sends.push(args); return { code: sendCode, stderr: "send failed" }; },
    run: (name, args) => { calls.runs.push({ name, args }); if (runError && (name === "space.new" || name === "tab.new")) throw runError; return null; },
    notify: (value) => calls.notifications.push(value),
    spaces: () => [],
    exec: async () => ({ code: 0, stdout: "" }),
    readTextFile: async () => null,
  });
  vm.runInContext(`${source}\nthis.Todos = Todos;`, context, { filename: "mod/main.js" });
  const model = Object.create(context.Todos.prototype);
  model.lists = { project: { folder: "/project", items: [open("Parent"), open("Existing child", 1)], raw: "" } };
  model.fileAt = {};
  model.name = () => "Project";
  model.write = async (slug, folder, items) => { model.lists[slug] = { ...model.lists[slug], folder, items }; return true; };
  const cx = { spawn(fn) { calls.pending.push(Promise.resolve().then(() => fn(cx))); } };
  const item = { ...model.lists.project.items[0], slug: "project", i: 0, folder: "/project" };
  const settle = async () => { while (calls.pending.length) await Promise.all(calls.pending.splice(0)); };
  return { model, cx, item, calls, settle, parse: vm.runInContext("parse", context) };
}

test("WBS child is first under its parent and repeated assignment reuses it", () => {
  const items = [open("Parent"), open("Existing child", 1), open("Other root")];
  const created = ensureWbsChild(items, 0, startedAt);
  assert.equal(created.index, 1);
  assert.equal(items[1].text, WBS_LABEL);
  assert.equal(items[1].depth, 1);
  assert.equal(items[1].doing, true);
  assert.equal(items[2].text, "Existing child");
  assert.equal(findWbsChild(items, 0), 1);
  assert.equal(ensureWbsChild(items, 0, "later").unchanged, true);
  assert.equal(items.filter((x) => x.text === WBS_LABEL).length, 1);
  assert.equal(items[1].updatedAt, startedAt);
});

test("a completed WBS child is reopened instead of duplicated", () => {
  const child = { ...open(WBS_LABEL, 1), done: true, doneOn: "yesterday" };
  const items = [open("Parent"), child, open("Other root")];
  const result = ensureWbsChild(items, 0, startedAt);
  assert.equal(result.before, child);
  assert.equal(items[1].done, false);
  assert.equal(items[1].doing, true);
  assert.equal(items[1].doneOn, null);
  assert.equal(items.length, 3);
});

test("WBS assignment writes parent and tracking child together, then can roll back", async () => {
  const { model, cx, item } = modelHarness();
  const snapshots = [];
  model.write = async (slug, folder, items) => {
    snapshots.push(items.map((x) => ({ ...x })));
    model.lists[slug] = { ...model.lists[slug], folder, items };
    return true;
  };
  const changes = [];
  assert.equal(await model.markAssigned([item], cx, changes, "wbs"), true);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0][0].doing, true);
  assert.equal(snapshots[0][1].text, WBS_LABEL);
  assert.equal(snapshots[0][1].depth, 1);
  assert.equal(snapshots[0][2].text, "Existing child");
  assert.deepEqual(Array.from(bucketItems(snapshots[0])), ["doing", "doing", "doing"]);
  await model.restoreAssignment(changes, cx);
  assert.equal(model.lists.project.items[0].doing, false);
  assert.deepEqual(model.lists.project.items.map((x) => x.text), ["Parent", "Existing child"]);
});

test("failed send rolls back the WBS child and parent; successful send sees both", async () => {
  const failed = modelHarness({ sendCode: 1 });
  failed.model.sendTo({ address: "agent-1" }, failed.item, "wbs", failed.cx);
  await failed.settle();
  assert.equal(failed.calls.sends.length, 1);
  assert.equal(failed.model.lists.project.items[0].doing, false);
  assert.equal(findWbsChild(failed.model.lists.project.items, 0), -1);

  const sent = modelHarness();
  sent.model.sendTo({ address: "agent-1" }, sent.item, "wbs", sent.cx);
  await sent.settle();
  assert.equal(sent.model.lists.project.items[0].doing, true);
  assert.equal(findWbsChild(sent.model.lists.project.items, 0), 1);
  assert.match(sent.calls.sends[0][2], /done <child number>/);
  assert.match(sent.calls.sends[0][2], /open <parent number>/);
});

test("new-agent launch sees prepared WBS; synchronous failure restores both", async () => {
  const started = modelHarness();
  started.model.startAgent({ name: "Agent", run: ["agent"] }, started.item, "wbs", started.cx);
  await started.settle();
  assert.equal(started.calls.runs.some((x) => x.name === "space.new"), true);
  assert.equal(started.model.lists.project.items[0].doing, true);
  assert.equal(findWbsChild(started.model.lists.project.items, 0), 1);

  const failed = modelHarness({ runError: Error("launch failed") });
  failed.model.startAgent({ name: "Agent", run: ["agent"] }, failed.item, "wbs", failed.cx);
  await failed.settle();
  assert.equal(failed.model.lists.project.items[0].doing, false);
  assert.equal(findWbsChild(failed.model.lists.project.items, 0), -1);
});

test("WBS prompt keeps the approval gate and uses list numbers for duplicate names", () => {
  const prompt = wbsPrompt({ parentText: "Parent", target: "project's list", todo: "todo -p \"/project\"" });
  assert.ok(prompt.indexOf("wait for my confirmation") < prompt.indexOf("add --under <parent number>"));
  assert.match(prompt, /done <child number>/);
  assert.match(prompt, /open <parent number>/);
  assert.match(prompt, /Leave every new work item unchecked/);
  assert.match(prompt, /Do not tick the parent or the new work items/);
});

test("CLI completion ticks only breakdown, reopens parent, and leaves work items open", () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-wbs-"));
  const bash = (() => {
    if (process.platform !== "win32") return "bash";
    const result = spawnSync("where.exe", ["cygpath"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return join(dirname(result.stdout.trim().split(/\r?\n/)[0]), "bash.exe");
  })();
  const posix = (path) => {
    if (process.platform !== "win32") return path;
    const result = spawnSync("cygpath", ["-u", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const data = posix(join(dir, "data"));
  const project = posix(join(dir, "project"));
  mkdirSync(join(dir, "project"));
  const cli = posix(join(root, "mod/todo.sh"));
  const readList = () => {
    const listDir = join(dir, "data", "over9k", "todos");
    const file = readdirSync(listDir).find((name) => name.endsWith(".md"));
    assert.ok(file);
    return readFileSync(join(listDir, file), "utf8");
  };
  const { parse } = modelHarness();
  const todo = (...args) => {
    const result = spawnSync(bash, [cli, "-p", project, ...args], { encoding: "utf8", env: { ...process.env, XDG_DATA_HOME: data } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    todo("add", "Parent");
    todo("doing", "Parent");
    todo("add", "--under", "Parent", WBS_LABEL);
    todo("doing", WBS_LABEL);
    todo("add", "--under", "Parent", "Work item A");
    todo("add", "--under", "Parent", "Work item B");
    const before = todo();
    assert.match(before, /\[~\] Parent/);
    assert.match(before, /\[~\]   工作拆解/);
    assert.deepEqual(Array.from(bucketItems(parse(readList()).items)), ["doing", "doing", "doing", "doing"]);
    todo("done", "2");
    todo("open", "1");
    const after = todo();
    assert.match(after, /\[ \] Parent/);
    assert.match(after, /\[x\]   工作拆解/);
    assert.match(after, /\[ \]   Work item A/);
    assert.match(after, /\[ \]   Work item B/);
    assert.deepEqual(Array.from(bucketItems(parse(readList()).items)), ["todo", "done", "todo", "todo"]);
  } finally {
    const target = resolve(dir), base = resolve(tmpdir());
    assert.ok(target.startsWith(base + sep) && basename(target).startsWith("herdr-wbs-"), `unsafe cleanup target: ${target}`);
    rmSync(dir, { recursive: true, force: true });
  }
});
