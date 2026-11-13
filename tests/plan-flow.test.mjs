import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { bucketItems } from "../mod/todo-buckets.mjs";
import { WBS_LABEL, findWbsChild, ensureWbsChild, wbsPrompt } from "../mod/wbs-flow.mjs";
import { planPrompt } from "../mod/plan-flow.mjs";

const root = resolve(import.meta.dirname, "..");
const open = (text, depth = 0) => ({ text, depth, done: false, doing: false, doneOn: null, updatedAt: null });

function modelHarness({ sendCode = 0, runError = null, writeFails = false } = {}) {
  const calls = { sends: [], runs: [], notifications: [], pending: [] };
  let model;
  const source = readFileSync(join(root, "mod/main.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export default class Todos", "class Todos");
  const context = vm.createContext({
    View: class {}, WBS_LABEL, findWbsChild, ensureWbsChild, wbsPrompt,
    planPrompt, bucketItems,
    home: () => "/home/test", appHome: () => "/app", shared: () => ({}),
    hc: async (args) => { calls.sends.push(args); calls.sentItems = model.lists.project.items.map((x) => ({ ...x })); return { code: sendCode, stderr: "send failed" }; },
    run: (name, args) => { calls.runs.push({ name, args }); if (runError && (name === "space.new" || name === "tab.new")) throw runError; return null; },
    notify: (value) => calls.notifications.push(value),
    spaces: () => [], exec: async () => ({ code: 0, stdout: "" }), readTextFile: async () => null,
  });
  vm.runInContext(`${source}\nthis.Todos = Todos;`, context, { filename: "mod/main.js" });
  model = Object.create(context.Todos.prototype);
  model.lists = { project: { folder: "/project", items: [open("Parent"), open("Existing work item", 1)], raw: "" } };
  model.fileAt = {};
  model.name = () => "Project";
  model.write = async (slug, folder, items) => {
    if (writeFails) return false;
    model.lists[slug] = { ...model.lists[slug], folder, items };
    return true;
  };
  const cx = { spawn(fn) { calls.pending.push(Promise.resolve().then(() => fn(cx))); } };
  const item = { ...model.lists.project.items[0], slug: "project", i: 0, folder: "/project" };
  const settle = async () => { while (calls.pending.length) await Promise.all(calls.pending.splice(0)); };
  return { model, cx, item, calls, settle };
}

test("Plan assignment marks only its parent Doing without adding a child", async () => {
  const { model, cx, item } = modelHarness();
  const snapshots = [];
  model.write = async (slug, folder, items) => {
    snapshots.push(items.map((x) => ({ ...x })));
    model.lists[slug] = { ...model.lists[slug], folder, items };
    return true;
  };
  assert.equal(await model.markAssigned([item], cx, [], "plan"), true);
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].map((x) => x.text), ["Parent", "Existing work item"]);
  assert.deepEqual(bucketItems(snapshots[0]), ["doing", "doing"]);
});

test("Plan send sees a Doing parent and no new child", async () => {
  const sent = modelHarness();
  sent.model.sendTo({ address: "agent-1" }, sent.item, "plan", sent.cx);
  await sent.settle();
  assert.equal(sent.calls.sends.length, 1);
  assert.equal(sent.calls.sentItems[0].doing, true);
  assert.deepEqual(sent.calls.sentItems.map((x) => x.text), ["Parent", "Existing work item"]);
});

test("Plan send failure and launch failure restore only the parent state", async () => {
  const failedSend = modelHarness({ sendCode: 1 });
  failedSend.model.sendTo({ address: "agent-1" }, failedSend.item, "plan", failedSend.cx);
  await failedSend.settle();
  assert.equal(failedSend.calls.sends.length, 1);
  assert.equal(failedSend.model.lists.project.items[0].doing, false);
  assert.deepEqual(failedSend.model.lists.project.items.map((x) => x.text), ["Parent", "Existing work item"]);

  const failedLaunch = modelHarness({ runError: Error("launch failed") });
  failedLaunch.model.startAgent({ name: "Agent", run: ["agent"] }, failedLaunch.item, "plan", failedLaunch.cx);
  await failedLaunch.settle();
  assert.equal(failedLaunch.model.lists.project.items[0].doing, false);
  assert.deepEqual(failedLaunch.model.lists.project.items.map((x) => x.text), ["Parent", "Existing work item"]);
});

test("Plan dispatch is withheld when its Doing update cannot be written", async () => {
  const failedSend = modelHarness({ writeFails: true });
  failedSend.model.sendTo({ address: "agent-1" }, failedSend.item, "plan", failedSend.cx);
  await failedSend.settle();
  assert.equal(failedSend.calls.sends.length, 0);
  assert.equal(failedSend.model.lists.project.items[0].doing, false);

  const failedLaunch = modelHarness({ writeFails: true });
  failedLaunch.model.startAgent({ name: "Agent", run: ["agent"] }, failedLaunch.item, "plan", failedLaunch.cx);
  await failedLaunch.settle();
  assert.equal(failedLaunch.calls.runs.length, 0);
  assert.equal(failedLaunch.model.lists.project.items[0].doing, false);
});

test("Plan prompt saves consensus before closing the discussion", () => {
  const prompt = planPrompt({ parentText: "Parent", todo: 'todo -p "/project"' });
  assert.ok(prompt.indexOf("When we agree") < prompt.indexOf("note <parent number>"));
  assert.ok(prompt.indexOf("note <parent number>") < prompt.indexOf("open <parent number>"));
  assert.match(prompt, /Do not add any subitems/);
  assert.doesNotMatch(prompt, /done <child number>|add --under|規劃討論/);
  assert.match(prompt, /Do not tick the parent or any work items/);
});

test("a planning consensus becomes a note and returns its item to To-do", () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-plan-"));
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
  const todo = (...args) => {
    const result = spawnSync(bash, [cli, "-p", project, ...args], { encoding: "utf8", env: { ...process.env, XDG_DATA_HOME: data } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const readItems = () => {
    const listDir = join(dir, "data", "over9k", "todos");
    const file = readdirSync(listDir).find((name) => name.endsWith(".md"));
    assert.ok(file);
    const raw = readFileSync(join(listDir, file), "utf8");
    return raw.split(/\r?\n/).filter((line) => /^ *- \[[ x~]\] /.test(line));
  };
  const states = (lines) => bucketItems(lines.map((line) => ({
    depth: Math.floor(line.match(/^ */)[0].length / 2),
    done: /^ *- \[x\]/.test(line),
    doing: /^ *- \[~\]/.test(line),
  })));
  try {
    todo("add", "Parent");
    todo("doing", "Parent");
    assert.deepEqual(states(readItems()), ["doing"]);

    todo("note", "1", "Agree on the API shape first");
    assert.deepEqual(states(readItems()), ["doing"]);
    todo("open", "1");

    const items = readItems();
    assert.equal(items.length, 1);
    assert.match(items[0], /^- \[ \] Parent/);
    assert.match(items[0], /<!-- note: Agree on the API shape first -->/);
    assert.doesNotMatch(items[0], /<!-- updated: /);
    assert.deepEqual(states(items), ["todo"]);
  } finally {
    const target = resolve(dir), base = resolve(tmpdir());
    assert.ok(target.startsWith(base + sep) && basename(target).startsWith("herdr-plan-"), `unsafe cleanup target: ${target}`);
    rmSync(dir, { recursive: true, force: true });
  }
});
