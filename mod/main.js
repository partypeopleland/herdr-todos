// To-dos across every project, shared with agents: the right panel's "To-do" (a
// child of the panel-body stack; over9k-tabs has its button).
// Each project's list is ~/.local/share/over9k/todos/<slug>.md (DATA_DIR; as todo.sh,
// $XDG_DATA_HOME/over9k/todos when that's set): a
// "<!-- folder: … -->" line, then "- [ ] text" / "- [x] text" lines, with
// "<!-- due: 2026-11-04 15:00 -->" (or a date alone) and "<!-- done: 2026-11-03 -->"
// after the text. The `todo` command (todo.sh) reads and writes the same files,
// so what an agent adds shows here at once (watchFolder), and back.
// In a space on another computer, the project you're in is that computer's: its
// list, TODO.md and new agents are there (read every 5s; HERE, loadThere).
// Shown: today's date; a chip per project with open to-dos (its colour, as the
// sidebar's: a hash of its folder's name) and "All"; one list, the project
// you're in first, then by due time; each to-do with its project and when it's
// due (red once past); "Doing" ([~]: being worked on, `todo doing`) and
// "Done today". Adding: to the project you're in, or
// "#name" for another; "@today" / "@fri" / "@nextweek" / "@in2h" / "@12nov" / "@4/11"
// (day and month in the computer's order; every form is listed above readWhen), with a time
// ("@14:30", "@fri 9am") or not. A circle ticks; double-click edits; × deletes.
// Ticked ones from before today stay in the file (`todo clear` removes them).
// A project's own TODO.md (read only for suggestions, "From TODO.md") gets
// its line crossed out when that to-do is ticked here or by `todo done`
// (todo-cross.py, next to this file; needs python3, else nothing is crossed out),
// and back in when unticked.
// Optional: shared "projects.names" / "projects.pinned" / "projects.auto" (the
// over9k sidebar writes them) add renamed and listed projects to "#" matches.
// The agent button by an open to-do or a TODO.md suggestion (on hover) lists the
// installed agents; one picked starts in that project's space (opened if it
// isn't) on that one to-do only, told to tick it with `todo done "<text>"` when
// it's finished. A suggestion goes on the list first.
// Tabs: All (your pinned projects, the sidebar's list, and the project
// you're in), a chip per project with open to-dos (filter to it), and the
// project you're in (following you as you move; kept for next time).
// On the project tab, Shift, Cmd/Meta or Ctrl + click picks to-dos (Shift:
// every one from the last picked); a bar then marks them done, sends them to
// an agent or deletes them together.
// Log and Sync are per project: the header's two tags switch them for the
// project you're in (hover names it). A project with neither
// switch set follows Options › To-do (shared "sidebar.options": todoLog,
// todoSync), as `todo` does (its todo-defaults file).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agentTask } from "./agent-name.js";
import { theme, exec, home, appHome, spaces, machines, focused, shared, readTextFile, writeTextFile, watchFolder, knownAgents, run, notify, panes, hc, agents, setShared } from "herdr";

// Python 3 runs as "python3", else "python" (as on Windows): found once.
let PY = null;
const python = (args) => (PY ??= exec("python3", ["-c", "1"]).then((r) => (r?.code === 0 ? "python3" : "python"), () => "python"))
  .then((p) => exec(p, args));

// Where the lists live: the same folder todo.sh uses. Resolved once at start
// (dataDir), from $XDG_DATA_HOME when the user's environment sets it.
const DATA_DIR = ".local/share/over9k/todos"; // under home
const XDG_DIR = 'printf %s "${XDG_DATA_HOME:+$XDG_DATA_HOME/over9k/todos}"';
let dataDir = null;
const DIR = () => dataDir ?? `${home()}/${DATA_DIR}`;
// Crosses a to-do out of (or back into) a project's own TODO.md.
const CROSS = () => `${appHome()}/mods/over9k-todos/todo-cross.py`;
// The project you're in when its space is on another computer: its list, its
// TODO.md and its agents are that computer's (findHere sets it).
const HERE = { folder: null, machine: null };
// folder -> machine for projects whose lists live on another computer (the
// spaces and lists seen so far): lets any of their lists be read and written
// there, not only the one you're in.
const FOLDER_M = new Map();
const mOf = (folder) => {
  if (!folder) return null;
  if (folder === HERE.folder) return HERE.machine;
  return FOLDER_M.get(folder.replace(/\/+$/, "")) ?? null;
};
const onM = (m) => (m ? { on: m } : {});
// Personal to-dos: not a project — this machine's own ~/.todo/todo-<machine>.md,
// local only, for things like "meeting at 3". `todo personal` writes the same
// file; other machines' copies pushed here keep their names (read-only there).
const PERSONAL = () => `${home()}/.todo`;
let myId = null, idP = null;
const machineId = () => (idP ??= exec("sh", ["-c", "hostname | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g'"])
  .then((r) => r?.stdout.trim() || "unknown", () => "unknown"));
const PFILE = () => `${PERSONAL()}/todo-${myId}.md`;
let personalSlug = null;
const isPersonal = (folder) => {
  if (!folder) return false;
  personalSlug ??= slugOf(PERSONAL()).toLowerCase();
  return slugOf(String(folder).replace(/\/+$/, "")).toLowerCase() === personalSlug;
};
// A list there is keyed "@<machine>:<slug>"; this computer's by its slug alone.
// The personal list's slug is fixed: "personal", whatever its folder string.
const keyOf = (folder) => (isPersonal(folder) ? "personal" : mOf(folder) ? `@${mOf(folder)}:${slugOf(folder)}` : slugOf(folder));
const machineOf = (key) => (key.startsWith("@") ? key.slice(1, key.indexOf(":")) : null);
// There, the list is read and written with sh (todo.sh's folder): a write only
// when the file still holds what was read ($3; $4 set: it was there), else 3.
const THERE_DIR = 'd="${XDG_DATA_HOME:-$HOME/.local/share}/over9k/todos"';
const THERE_READ = `${THERE_DIR}; cat "$d/$1.md" 2>/dev/null`;
const THERE_WRITE = `${THERE_DIR}; f="$d/$1.md"; mkdir -p "$d" || exit 1
if [ -e "$f" ]; then [ "$(cat "$f")" = "$(printf %s "$3")" ] || exit 3; elif [ -n "$4" ]; then exit 3; fi
printf %s "$2" > "$f.tmp" && mv "$f.tmp" "$f"`;
// Every list on a computer at once: a "\x1e<file>\n" record, then its text.
const THERE_ALL = `${THERE_DIR}; for f in "$d"/*.md; do [ -f "$f" ] || continue; printf '\\036%s\\n' "\${f##*/}"; cat "$f"; done`;
// THERE_ALL's output back into [slug, raw] pairs.
function parseThereAll(out) {
  const recs = [];
  for (const chunk of (out ?? "").split("\x1e")) {
    const nl = chunk.indexOf("\n"), head = chunk.slice(0, nl).trim();
    if (nl > 0 && /^[A-Za-z0-9-]+\.md$/.test(head)) recs.push([head.slice(0, -3), chunk.slice(nl + 1)]);
  }
  return recs;
}
// todo-cross.py on the computer the folder is on (there: its text, run with -c).
let crossText = null;
const cross = async (folder, ...args) => {
  const m = mOf(folder);
  if (!m) return python(["-I", CROSS(), folder, ...args]).catch(() => null);
  crossText ??= await readTextFile(CROSS()).catch(() => null);
  if (!crossText) return null;
  return exec("python3", ["-I", "-c", crossText, folder, ...args], onM(m)).catch(() => null);
};
// Sync on: what's added, edited or deleted here goes into the project's TODO.md too.
const toFile = (folder, ...args) => (SYNCED.has(folder) ? cross(folder, ...args) : null);
// Each project's switches, kept in its list file ("<!-- log: off -->",
// "<!-- sync: on -->"; `todo log|sync on|off` writes the same): Log, whether
// agents add what's asked for (on unless off); Sync, whether the project's
// TODO.md follows what's added, edited or deleted here (off unless on).
const SYNCED = new Set(); // folders with Sync on
const slugOf = (folder) => folder.replace(/\/+$/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ITEM = /^- \[( |x|~)\] (.*)$/;
// A click that picks rather than acts, as in the over9k sidebar.
// Log and Sync for a project that never set them: Options › To-do.
const defOpts = () => { const o = shared("sidebar.options") ?? {}; return { log: o.todoLog !== false, sync: o.todoSync === true }; };
const multi = (e) => Boolean(e?.modifiers && (e.modifiers.shift || e.modifiers.platform || e.modifiers.control));
const stamp = () => `${today()} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// over9k's project colours (MARK, hue): the same project, the same colour.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
function hue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
  const keys = Object.keys(MARK);
  return MARK[keys[h % keys.length]];
}

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dayKey(new Date());

// The computer's date and time preferences: day/month/year order and
// separator (its locale's d_fmt), 12- or 24-hour clock (GNOME's clock-format,
// macOS's 12/24-hour switch, else the locale's t_fmt). Read once at start
// (loadFormat); until then, and when nothing answers, 24-hour day/month/year.
const FORMAT_SH = `if [ "$(uname)" = Darwin ]; then
  loc=$(defaults read -g AppleLocale 2>/dev/null); loc=\${loc%%@*}
  LC_ALL="\${loc:-en_US}.UTF-8" locale -k d_fmt t_fmt 2>/dev/null
  [ "$(defaults read -g AppleICUForce24HourTime 2>/dev/null)" = 1 ] && echo 'clock="24h"'
  [ "$(defaults read -g AppleICUForce12HourTime 2>/dev/null)" = 1 ] && echo 'clock="12h"'
else
  locale -k d_fmt t_fmt 2>/dev/null
  c=$(gsettings get org.gnome.desktop.interface clock-format 2>/dev/null | tr -d "'")
  [ -n "$c" ] && echo "clock=\\"$c\\""
fi; true`;
let FMT = { order: ["d", "m", "y"], sep: "/", h12: false };
async function loadFormat() {
  const r = await exec("sh", ["-c", FORMAT_SH]).catch(() => null);
  const kv = Object.fromEntries([...(r?.stdout ?? "").matchAll(/^(\w+)="(.*)"$/gm)].map((m) => [m[1], m[2]]));
  const d = (kv.d_fmt ?? "").replace(/%D/g, "%m/%d/%y").replace(/%F/g, "%Y-%m-%d");
  const at = { d: d.search(/%[de]/), m: d.search(/%m/), y: d.search(/%[yY]/) };
  if (at.d >= 0 && at.m >= 0 && at.y >= 0) FMT.order = Object.keys(at).sort((a, b) => at[a] - at[b]);
  FMT.sep = /%[a-zA-Z]([^%\s])/.exec(d)?.[1] ?? FMT.sep;
  FMT.h12 = kv.clock ? kv.clock === "12h" : /%[Ilpr]/.test(kv.t_fmt ?? "");
}
// A date as the computer writes it: "4/11" (no year) or "04/11/2026" (`full`).
function fmtDate(d, full = false) {
  const part = { d: full ? pad(d.getDate()) : String(d.getDate()), m: full ? pad(d.getMonth() + 1) : String(d.getMonth() + 1), y: String(d.getFullYear()) };
  return FMT.order.filter((k) => full || k !== "y").map((k) => part[k]).join(FMT.sep);
}
// "HH:MM" as the computer's clock shows it: "15:30", or "3:30pm".
function fmtTime(hm) {
  if (!FMT.h12 || !hm) return hm;
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`;
}
// A typed day and month ("4/11", "4.11", "4-11", "4/11/2027") in the computer's
// order: [month, day, year or undefined].
function readDayMonth(word) {
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(word);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined;
  const order = FMT.order.filter((k) => k !== "y");
  return order[0] === "d" ? [+m[2], +m[1], y] : [+m[1], +m[2], y];
}

function parseLine(text) {
  const due = /<!-- due: ([^>]*?) -->/.exec(text)?.[1] ?? null;
  const done = /<!-- done: ([^>]*?) -->/.exec(text)?.[1] ?? null;
  return { text: text.replace(/\s*<!--[^>]*-->/g, "").trim(), due, doneOn: done };
}
// "<!-- skip: text -->" lines: TODO.md items hidden from the suggestions.
function parse(raw) {
  const folder = /^<!-- folder: (.*) -->$/m.exec(raw ?? "")?.[1] ?? null;
  const items = (raw ?? "").split("\n").map((l) => ITEM.exec(l)).filter(Boolean).map((m) => ({ done: m[1] === "x", doing: m[1] === "~", ...parseLine(m[2]) }));
  const skipped = [...(raw ?? "").matchAll(/^<!-- skip: (.*) -->$/gm)].map((m) => m[1]);
  // "<!-- log: on|off -->" / "<!-- sync: on|off -->" when set, else the default.
  const d = defOpts(), log = /^<!-- log: (on|off) -->$/m.exec(raw ?? "")?.[1], sync = /^<!-- sync: (on|off) -->$/m.exec(raw ?? "")?.[1];
  const opts = { log: log ? log === "on" : d.log, sync: sync ? sync === "on" : d.sync, set: { log: Boolean(log), sync: Boolean(sync) } };
  return { folder, items, skipped, opts };
}
const line = (i) => `- [${i.done ? "x" : i.doing ? "~" : " "}] ${i.text.replace(/\n/g, " ")}${i.due ? ` <!-- due: ${i.due} -->` : ""}${i.done && i.doneOn ? ` <!-- done: ${i.doneOn} -->` : ""}`;
const serialize = (folder, items, skipped = [], opts = {}) => `<!-- folder: ${folder} -->\n${opts.set?.log ? `<!-- log: ${opts.log ? "on" : "off"} -->\n` : ""}${opts.set?.sync ? `<!-- sync: ${opts.sync ? "on" : "off"} -->\n` : ""}${skipped.map((x) => `<!-- skip: ${x.replace(/-->/g, "")} -->\n`).join("")}${items.map(line).join("\n")}${items.length ? "\n" : ""}`;

// A project's own to-do file (TODO.md and the like), read, never written: its
// open items ("- [ ] …", or every bullet when it has no checkboxes).
const TODO_FILE = `for f in TODO.md todo.md Todo.md TODO TODO.txt docs/TODO.md; do [ -f "$1/$f" ] && { printf '%s\\n' "$f"; head -c 65536 "$1/$f"; exit 0; }; done`;
function fileItems(text) {
  const lines = text.split("\n");
  const boxes = lines.some((l) => /^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]/.test(l));
  const clean = (x) => x.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  return lines.map((l) => (boxes ? /^\s*(?:[-*+]|\d+\.)\s+\[ \]\s+(.+)$/.exec(l) : /^\s*(?:[-*+]|\d+\.)\s+(.+)$/.exec(l))?.[1])
    .filter((x) => x && !/^~~.*~~\s*$/.test(x.trim())).map(clean).filter((x) => x && x.length < 300).slice(0, 40);
}

// Ways to say when, after "@" (one word; a time may follow a day word):
//   today, tonight (20:00), tomorrow / tmr / tmrw
//   mon … sun (the coming one), nextfri (next week's), weekend (Saturday),
//   eow / "end of week" (Friday), "next week" (Monday), eom / "end of month",
//   "next month" (the 1st); "in 2 hours", "in a day", "this fri" (as below, spaced)
//   morning 9:00, noon 12:00, afternoon 14:00, evening 18:00, eod 17:00
//     (today, or tomorrow once that time has passed)
//   in30m, in2h, in3d, in2w, in1mo (from now)
//   4/11, 4/11/2027 (day and month in the computer's order), 2026-11-04, 12nov, nov12
//   14:30, 9am, 9:30pm (today, or tomorrow once passed)
// e.g. "@fri 9am", "@nextweek morning", "@12nov 15:00".
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PARTS = { morning: "09:00", noon: "12:00", midday: "12:00", afternoon: "14:00", evening: "18:00", tonight: "20:00", eod: "17:00", midnight: "00:00" };
// A time: "14:30", "9am", "9:30pm", "3p", "3.30pm", "9 a.m.", "15h", "15h30",
// "1530", "5 o'clock", "15" (13–23 can only be an hour), or a part of the day.
// `loose`: any bare hour counts (it follows a day or "at"): 1–7 read as the
// afternoon ("fri 3" → 15:00), and every hour before noon does after an
// evening word (`pm`: "tonight 9" → 21:00).
function readTime(s, loose = false, pm = false) {
  let w = (s ?? "").toLowerCase().replace(/\s+/g, "").replace(/([ap])\.m\.?$/, "$1m");
  if (PARTS[w]) return PARTS[w];
  const oclock = /o'?clock$/.test(w);
  w = w.replace(/o'?clock$/, "");
  const m = /^(\d{1,2})(?:[:.](\d{2})|h(\d{2})?|(\d{2}))?([ap]m?)?$/.exec(w);
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] ?? m[3] ?? m[4] ?? 0);
  const bare = !m[2] && !m[4] && !w.includes("h") && !m[5];
  if (bare && !oclock && !loose && !(h >= 13 && h <= 23)) return null;
  if (m[5]) { if (h > 12 || h === 0) return null; if (h === 12) h = 0; if (m[5][0] === "p") h += 12; }
  else if (bare && h >= 1 && h < 12 && (pm || h <= 7)) h += 12;
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}
const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayOf = (s) => DAYS.findIndex((x) => s.startsWith(x));
const monthOf = (s) => (s.length >= 3 ? MONTHS.findIndex((x) => s.startsWith(x)) : -1);
// A date this year, or next year's once it has passed.
function ahead(mo, da, today) {
  const d = new Date(today.getFullYear(), mo, da);
  if (d.getMonth() !== mo) return null;
  if (d < today) d.setFullYear(d.getFullYear() + 1);
  return d;
}
// One "@" word as { d: the day, at: "HH:MM" or null }, or null when it isn't one.
function readWhen(word, now = new Date()) {
  const w = word.toLowerCase(), today = startOf(now), dow = today.getDay();
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let m;
  if (w === "today") return { d: today, at: null };
  if (w === "tonight") return { d: today, at: PARTS.tonight };
  if (["tomorrow", "tmr", "tmrw", "tom"].includes(w)) return { d: plusDays(today, 1), at: null };
  if (PARTS[w]) return { d: PARTS[w] <= hm ? plusDays(today, 1) : today, at: PARTS[w] };
  if (w === "weekend") return { d: plusDays(today, dow === 0 ? 0 : 6 - dow), at: null };
  if (w === "eow") return { d: plusDays(today, (5 - dow + 7) % 7), at: null };
  if (w === "nextweek") return { d: plusDays(today, (1 - dow + 7) % 7 || 7), at: null };
  if (w === "eom") return { d: new Date(today.getFullYear(), today.getMonth() + 1, 0), at: null };
  if (w === "nextmonth") return { d: new Date(today.getFullYear(), today.getMonth() + 1, 1), at: null };
  if ((m = /^next([a-z]{3,})$/.exec(w)) && dayOf(m[1]) >= 0) {
    const monday = plusDays(today, (1 - dow + 7) % 7 || 7);
    return { d: plusDays(monday, (dayOf(m[1]) + 6) % 7), at: null };
  }
  if (/^[a-z]{3,}$/.test(w) && dayOf(w) >= 0) return { d: plusDays(today, (dayOf(w) - dow + 7) % 7 || 7), at: null };
  if ((m = /^in(\d+)(m|min|mins|h|hr|hrs|d|w|wk|mo)$/.exec(w))) {
    const n = +m[1], u = m[2];
    if (/^(m|min|mins|h|hr|hrs)$/.test(u)) {
      const t = new Date(now.getTime() + n * (u.startsWith("h") ? 3600000 : 60000));
      return { d: startOf(t), at: `${pad(t.getHours())}:${pad(t.getMinutes())}` };
    }
    if (u === "mo") { const d = new Date(today); d.setMonth(d.getMonth() + n); return { d, at: null }; }
    return { d: plusDays(today, n * (u === "d" ? 1 : 7)), at: null };
  }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w))) return { d: new Date(+m[1], +m[2] - 1, +m[3]), at: null };
  const dm = readDayMonth(w);
  if (dm) { const [mo, da, y] = dm; const d = y ? new Date(y, mo - 1, da) : ahead(mo - 1, da, today); return d ? { d, at: null } : null; }
  if ((m = /^(\d{1,2})([a-z]{3,})$/.exec(w) ?? /^([a-z]{3,})(\d{1,2})$/.exec(w))) {
    const [da, mon] = /^\d/.test(m[1]) ? [+m[1], m[2]] : [+m[2], m[1]];
    const d = monthOf(mon) >= 0 ? ahead(monthOf(mon), da, today) : null;
    return d ? { d, at: null } : null;
  }
  const at = readTime(w);
  if (at) return { d: at <= hm ? plusDays(today, 1) : today, at };
  return null;
}
// A phrase as the one word readWhen knows: "next week" → nextweek, "in 2 hours"
// → in2h, "in a day" → in1d, "end of week" → eow, "this fri" → fri, "12 nov" → 12nov.
function normWhen(s) {
  const w = s.toLowerCase().replace(/\s+/g, "");
  const m = /^in(\d+|an?|one)(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mo)$/.exec(w);
  if (m) {
    const u = m[2].startsWith("mo") ? "mo" : m[2] === "m" || m[2].startsWith("mi") ? "m" : m[2][0];
    return `in${/^\d+$/.test(m[1]) ? m[1] : "1"}${u}`;
  }
  return { endofweek: "eow", endofmonth: "eom", endofday: "eod", thisweekend: "weekend", thisweek: "eow", thismonth: "eom" }[w] ?? w.replace(/^this(?=[a-z]{3,}$)/, "");
}
// "@tomorrow 15:00", "@fri 9am", "@next week morning", "@in 2 hours" in what's
// typed: the due ("YYYY-MM-DD" or "YYYY-MM-DD HH:MM") and the text without it.
// The longest run of up to four words after "@" that reads as a when wins, then
// a time may follow ("at" before it is fine).
function takeDue(text) {
  const head = /(?:^|\s)@(?=\S)/.exec(text);
  if (!head) return { text, due: null };
  const from = head.index + head[0].length;
  const words = [...text.slice(from).matchAll(/\S+/g)].slice(0, 9).map((x) => ({ w: x[0], end: from + x.index + x[0].length }));
  const lw = (i) => words[i]?.w.toLowerCase() ?? "";
  // A time from word i ("at" before it, a spaced "pm" after it): [time, its last word] or null.
  const timeAt = (i, loose = false, pm = false) => {
    if (lw(i) === "at") { i++; loose = true; }
    if (/^[ap]\.?m\.?$/.test(lw(i + 1))) { const t = readTime(`${lw(i)}${lw(i + 1)}`); if (t) return [t, i + 1]; }
    const t = readTime(lw(i), loose, pm);
    return t ? [t, i] : null;
  };
  // A day from word i (up to four words, "on" before it): [when, its last word] or null.
  const dayAt = (i) => {
    if (lw(i) === "on") i++;
    for (let k = Math.min(4, words.length - i); k >= 1; k--) {
      const when = readWhen(normWhen(words.slice(i, i + k).map((x) => x.w).join(" ")));
      if (when) return [when, i + k - 1];
    }
    return null;
  };
  let when, end;
  const t0 = lw(0) === "tonight" ? null : timeAt(0);
  if (t0) {
    // A time first: a day may follow ("3pm tomorrow"), else today or tomorrow.
    const d = dayAt(t0[1] + 1);
    if (d && !d[0].at) [when, end] = [{ d: d[0].d, at: t0[0] }, d[1]];
    else [when, end] = [readWhen(t0[0]), t0[1]];
  } else {
    const d = dayAt(0);
    if (!d) return { text, due: null };
    [when, end] = [{ ...d[0] }, d[1]];
    const t = timeAt(end + 1, true, (when.at ?? "") >= "12:00");
    if (t) [when.at, end] = [t[0], t[1]];
  }
  const rest = (text.slice(0, head.index) + " " + text.slice(words[end].end)).replace(/\s+/g, " ").trim();
  return { text: rest, due: when.at ? `${dayKey(when.d)} ${when.at}` : dayKey(when.d) };
}
// The phrases offered while typing after "@" (each also works as typed).
const PHRASES = ["today", "tonight", "tomorrow", "morning", "noon", "afternoon", "evening", "end of day", "this weekend", "end of week", "next week",
  "next mon", "next tue", "next wed", "next thu", "next fri", "next sat", "next sun", "end of month", "next month",
  "in 30 minutes", "in 1 hour", "in 2 hours", "in 3 hours", "in 1 day", "in 2 days", "in 3 days", "in 1 week", "in 2 weeks", "in 1 month"];

// A due as words: "today 15:00", "tomorrow", "fri 9:00", "4/11" (in the computer's formats).
function dueWords(due) {
  const [day, at] = due.split(" ");
  const d = new Date(`${day}T00:00:00`), now = new Date();
  const diff = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const words = diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff === -1 ? "yesterday" : diff > 1 && diff < 7 ? DAYS[d.getDay()] : fmtDate(d);
  return at ? `${words} ${fmtTime(at)}` : words;
}
// When it was ticked: "15:30" (today), "yesterday 9:00", "mon 9:00", "28/10".
function doneWords(on) {
  const [day, at] = on.split(" ");
  const d = new Date(`${day}T00:00:00`), now = new Date();
  const diff = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  // Today: just the time.
  if (diff === 0) return at ? fmtTime(at) : "today";
  const words = diff === -1 ? "yesterday" : diff < 0 && diff > -7 ? DAYS[d.getDay()] : fmtDate(d);
  return at ? `${words} ${fmtTime(at)}` : words;
}
const overdue = (due) => (due.includes(" ") ? new Date(due.replace(" ", "T")) : new Date(`${due}T23:59:59`)) < new Date();

// What to offer for the word being typed (the last one): "#…" projects,
// "@…" days, dates and times, and a time after "@<day> ". Each: what goes in
// (replacing that word), a label and a hint.
const TIMES = () => { const out = []; for (let h = 7; h <= 22; h++) for (const m of [0, 30]) out.push(FMT.h12 ? fmtTime(`${pad(h)}:${pad(m)}`) : `${h}:${pad(m)}`); return out; };
function suggest(value, projects) {
  const last = /(\S*)$/.exec(value)[1];
  const lower = last.toLowerCase();
  const now = new Date();
  const dayHint = (d) => `${DAYS[d.getDay()][0].toUpperCase()}${DAYS[d.getDay()].slice(1)} ${fmtDate(d)}`;
  const timeList = (want) => {
    const ampm = /^(\d{1,2})(a|p)/i.exec(want);
    if (ampm) return [`${ampm[1]}${ampm[2].toLowerCase()}m`, `${ampm[1]}:30${ampm[2].toLowerCase()}m`];
    return TIMES().filter((x) => !want || x.startsWith(want) || pad(+x.split(":")[0]) === want.padStart(2, "0").slice(0, 2) && x.startsWith(String(+want)));
  };
  if (lower.startsWith("#")) {
    const want = lower.slice(1);
    return projects.filter((p) => !want || p.key.toLowerCase().startsWith(want) || p.name.toLowerCase().startsWith(want)).slice(0, 7)
      .map((p) => ({ insert: `#${p.key}`, label: p.name, hint: p.key !== p.name ? p.key : "", color: p.color }));
  }
  // When a word lands, as its hint: "today 9:00", "Fri 7/11 9:00".
  const hintOf = (word) => {
    const r = readWhen(word, now);
    if (!r) return null;
    const diff = Math.round((r.d - startOf(now)) / 86400000);
    return `${diff === 0 ? "today" : diff === 1 ? "tomorrow" : dayHint(r.d)}${r.at ? ` ${fmtTime(r.at)}` : ""}`;
  };
  // Further words of an "@" phrase: "@next w" → week, "@in 2 h" → hours.
  const ph = /(?:^|\s)@([a-z]+(?:\s+[a-z0-9]*){1,3})$/i.exec(value);
  if (ph && !lower.startsWith("@")) {
    const typed = ph[1].toLowerCase().replace(/\s+/g, " "), n = /^in (\d+) ?[a-z]*$/.exec(typed)?.[1];
    const list = n ? ["minutes", "hours", "days", "weeks", "months"].map((u) => `in ${n} ${+n === 1 ? u.slice(0, -1) : u}`) : PHRASES;
    const got = list.filter((p) => p.startsWith(typed) && p !== typed).map((p) => ({ p, hint: hintOf(normWhen(p)) })).filter((x) => x.hint).slice(0, 7)
      .map(({ p, hint }) => ({ insert: p.slice(typed.length - last.length), label: p, hint }));
    if (got.length) return got;
  }
  if (lower.startsWith("@")) {
    const want = lower.slice(1), out = [];
    const offer = (words) => words.filter((w) => w.startsWith(want)).map((w) => ({ w, hint: hintOf(w) })).filter((x) => x.hint).slice(0, 7)
      .map(({ w, hint }) => ({ insert: `@${w}`, label: w, hint }));
    if (/^\d/.test(want)) {
      // A date (4/11, 4/11/2027) or a time (14:30, 9am) or a day and month (12nov).
      if (/[/.-]/.test(want) && !/^\d{1,2}:/.test(want)) {
        for (let k = 0; k < 400 && out.length < 7; k++) { const d = plusDays(now, k); const md = fmtDate(d); if (md.startsWith(want.replace(/[/.-]/g, FMT.sep)) && !out.some((x) => x.label === md)) out.push({ insert: `@${md}`, label: md, hint: dayHint(d) }); }
        return out;
      }
      const dm = /^(\d{1,2})([a-z]*)$/.exec(want);
      if (dm && dm[2]) return offer(MONTHS.map((x) => `${dm[1]}${x}`));
      const mins = (x) => { const t = readTime(x); return t ? +t.slice(0, 2) * 60 + +t.slice(3) : 0; };
      const nowMin = now.getHours() * 60 + now.getMinutes();
      return timeList(want).slice(0, 7).map((x) => ({ insert: `@${x}`, label: x, hint: mins(x) <= nowMin ? "tomorrow" : "today" }));
    }
    // "in…": from now.
    if (/^in\d*[a-z]*$/.test(want) && want.startsWith("i")) {
      const n = /^in(\d+)/.exec(want)?.[1];
      if (!n) return PHRASES.filter((p) => p.startsWith("in ")).map((p) => ({ p, hint: hintOf(normWhen(p)) })).slice(0, 7).map(({ p, hint }) => ({ insert: `@${p}`, label: p, hint }));
      return offer(["m", "h", "d", "w", "mo"].map((u) => `in${n}${u}`));
    }
    // A month and day: "nov", "nov1…".
    const md = /^([a-z]{3,})(\d{0,2})$/.exec(want);
    if (md && monthOf(md[1]) >= 0 && !(dayOf(md[1]) >= 0) && (md[2] || md[1].length >= 3)) {
      const mon = MONTHS[monthOf(md[1])], days = [];
      for (let k = 1; k <= 31; k++) if (String(k).startsWith(md[2])) days.push(`${mon}${k}`);
      const got = offer(days.filter((x) => x.startsWith(want) || md[2] === ""));
      if (got.length) return got;
    }
    const coming = []; for (let k = 2; k < 8; k++) coming.push(DAYS[plusDays(now, k).getDay()]);
    const list = [...PHRASES.slice(0, 3), ...coming, ...PHRASES.slice(3)];
    return list.filter((w) => w.startsWith(want)).map((w) => ({ w, hint: hintOf(normWhen(w)) })).filter((x) => x.hint).slice(0, 7)
      .map(({ w, hint }) => ({ insert: `@${w}`, label: w, hint }));
  }
  // A time after a day: "@fri 9…".
  if (/(?:^|\s)@\S+\s+\S*$/.test(value) && /^\d/.test(lower) && !/(?:^|\s)@\d/.test(value.slice(0, value.length - last.length).trim().split(/\s+/).slice(-1)[0] ?? "")) {
    return timeList(lower).slice(0, 7).map((x) => ({ insert: x, label: x, hint: "" }));
  }
  return [];
}

export default class Todos extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => { await loadFormat(); cx.notify(); });
    this.lists = {}; // slug -> { folder, items, raw }
    this.here = null;
    this.hereFrom = null;
    // The tabs: "all" (your pinned projects, and the one you're in) or "here"
    // (only the project you're in, following you). this.filter is worked out
    // from it on each render: here's slug, or null for All.
    try { this.mode = localStorage.getItem("todos.mode") === "all" ? "all" : "here"; } catch { this.mode = "here"; }
    this.proj = null; // a project chip's slug: All filtered to it (this session)
    this.filter = null;
    this.editing = null; // { slug, i }
    this.hover = null;
    this.input = InputState.new({ placeholder: "Add a to-do (#project @when)" });
    this.typed = "";
    this.sugAt = 0;
    this.sugOff = null; // the text Esc hid suggestions for
    this.input.on("change", (_e, cx) => { this.typed = this.input.value(); this.sugAt = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => { if (this.sugs?.length) this.accept(cx); else this.add(this.input.value(), cx); });
    this.editInput = InputState.new({});
    this.editInput.on("submit", (_e, cx) => this.saveEdit(cx));
    this.editInput.on("blur", (_e, cx) => this.saveEdit(cx));
    cx.spawn(async (cx) => {
      dataDir = (await exec("sh", ["-c", XDG_DIR]).catch(() => null))?.stdout.trim() || null;
      await exec("mkdir", ["-p", DIR()]).catch(() => null);
      myId = await machineId();
      await exec("mkdir", ["-p", PERSONAL()]).catch(() => null);
      await this.load(cx);
      await this.loadRemote(cx);
      for (;;) {
        await watchFolder(DIR()).catch(() => cx.sleep(5000));
        await this.load(cx);
      }
    });
    // ~/.todo isn't under DIR: watch it too, so `todo personal` from a shell
    // (or a synced copy arriving) reloads the panel.
    cx.spawn(async (cx) => {
      for (;;) {
        await watchFolder(PERSONAL()).catch(() => cx.sleep(5000));
        await this.load(cx);
      }
    });
    cx.timer.every(1000, (cx) => this.findHere(cx));
    // Lists on other computers can't be watched: read them all every 5s.
    cx.timer.every(5000, (cx) => cx.spawn(async (cx) => this.loadRemote(cx)));
    cx.timer.every(15000, (cx) => { this.checkRule(cx); cx.notify(); }); // "today", overdue, TODO.md re-read, the rule
    this.ruleOk = true; // agents have the to-do rule (CLAUDE.md); off: a hint offers to set it up
    this.checkRule(cx);
    this.startFor = null; // the to-do whose agent choices show
    this.agentChoices = [];
    cx.spawn(async (cx) => { this.agentChoices = (await knownAgents().catch(() => [])).filter((a) => a.installed); cx.notify(); });
    this.sel = new Map(); // "slug:i" -> its text (a pick whose text moved is dropped)
    this.anchor = null; // the last one picked, for Shift
    this.fromFile = {}; // folder -> { file, items }
    this.fileAt = {}; // folder -> when it was last read (ms)
    this.fileStale = {}; // folder -> its list changed since TODO.md was read
  }

  async load(cx) {
    const r = await exec("ls", ["-1", DIR()]).catch(() => null);
    const lists = {};
    for (const f of (r?.stdout ?? "").split("\n").filter((x) => x.endsWith(".md"))) {
      const raw = await readTextFile(`${DIR()}/${f}`).catch(() => null);
      if (raw == null) continue;
      const { folder, items, skipped, opts } = parse(raw);
      if (folder) lists[f.slice(0, -3)] = { folder: isPersonal(folder) ? PERSONAL() : folder, items, skipped, opts, raw };
    }
    // The personal list lives outside DIR, in ~/.todo: this machine's own file.
    const praw = myId ? await readTextFile(PFILE()).catch(() => null) : null;
    const prevPersonal = this.lists?.personal?.raw ?? null;
    // The personal list exists even before its first item (its chip shows 0).
    if (praw != null) {
      const p = parse(praw);
      lists.personal = { folder: PERSONAL(), items: p.items, skipped: p.skipped, opts: p.opts, raw: praw };
    } else lists.personal ??= { folder: PERSONAL(), items: [], skipped: [], opts: defOpts(), raw: null };
    // A list that changed: its TODO.md is read again before suggesting from it
    // (an agent's edit reaches TODO.md a moment after the list).
    for (const [slug, l] of Object.entries(lists)) if (this.lists?.[slug]?.raw !== l.raw) { this.fileAt[l.folder] = 0; this.fileStale[l.folder] = true; }
    for (const [k, l] of Object.entries(this.lists ?? {})) if (l.machine) lists[k] = l;
    this.lists = lists;
    SYNCED.clear();
    for (const l of Object.values(lists)) if (l.opts.sync) SYNCED.add(l.folder);
    // The personal file changed here (a `todo personal` in a shell, or the
    // panel's own write already pushed): send the new copy to the machines.
    if (praw !== prevPersonal) this.pushPersonal(cx);
    cx.notify();
  }

  // The list of the project you're in, when that's on another computer (read
  // from there at once); loadRemote keeps every computer's lists current.
  async loadThere(cx) {
    const m = HERE.machine, folder = HERE.folder, key = m && keyOf(folder);
    const raw = m ? (await exec("sh", ["-c", THERE_READ, "sh", slugOf(folder)], onM(m)).catch(() => null))?.stdout || null : null;
    if (m !== HERE.machine || folder !== HERE.folder) return; // moved on meanwhile
    const was = key && this.lists[key];
    if (!key || raw === (was?.raw ?? null)) return cx.notify();
    const p = raw && parse(raw);
    if (p?.folder) {
      this.lists[key] = { ...p, raw, machine: m };
      this.fileAt[p.folder] = 0; this.fileStale[p.folder] = true;
      if (p.opts.sync) SYNCED.add(p.folder); else SYNCED.delete(p.folder);
    } else delete this.lists[key];
    cx.notify();
  }

  // Every project's list on every other computer (their agents write theirs
  // whether or not you're looking at that project): one read per machine.
  // A machine that doesn't answer keeps what was last read; one gone from
  // `hc machine ls` has its lists dropped.
  async loadRemote(cx) {
    const r = await hc(["machine", "ls", "--json"]).catch(() => null);
    let ms = null;
    try { ms = r?.code === 0 ? (JSON.parse(r.stdout).machines ?? []).filter((x) => x.name && !x.temporary).map((x) => x.name) : null; } catch { ms = null; }
    if (!ms) ms = machines().filter((x) => x.name).map((x) => x.name);
    const found = {}, seen = new Set();
    await Promise.all(ms.map(async (m) => {
      const res = await exec("sh", ["-c", THERE_ALL, "sh"], onM(m)).catch(() => null);
      if (res?.code !== 0) return;
      seen.add(m);
      for (const [slug, raw] of parseThereAll(res.stdout)) {
        const p = parse(raw);
        if (!p.folder) continue;
        const folder = p.folder.replace(/\/+$/, ""), key = `@${m}:${slug}`;
        found[key] = { ...p, folder, raw, machine: m };
        FOLDER_M.set(folder, m);
        if (p.opts.sync) SYNCED.add(folder); else SYNCED.delete(folder);
      }
    }));
    for (const k of Object.keys(this.lists)) {
      const mk = machineOf(k);
      if (mk && (seen.has(mk) ? !(k in found) : !ms.includes(mk))) delete this.lists[k];
    }
    Object.assign(this.lists, found);
    this.remoteMachines = ms;
    // First look after start: push this machine's personal file to them all.
    if (!this.pushedInit) { this.pushedInit = true; this.pushPersonal(cx); }
    cx.notify();
  }

  // This machine's personal file, to every other computer's ~/.todo under the
  // same name (read-only there — the file name says whose it is). Pushed on
  // start and whenever it changes here; never pulled back.
  async pushPersonal(cx) {
    if (!myId) return;
    const raw = await readTextFile(PFILE()).catch(() => null);
    const ms = this.remoteMachines ?? [];
    if (raw == null || !ms.length) return;
    const name = `todo-${myId}.md`;
    await Promise.all(ms.map((m) => exec("sh", ["-c",
      'd="$HOME/.todo"; mkdir -p "$d" && printf %s "$1" > "$d/$2.tmp" && mv "$d/$2.tmp" "$d/$2"',
      "sh", raw, name], onM(m)).catch(() => null)));
  }

  // The project you're in: the focused terminal's folder (else the shown
  // space's), as a repo's main checkout (worktrees share it), as `todo` decides.
  // A project's Log or Sync switch (its list file is made if there's none).
  setOpt(folder, key, on, cx) {
    const slug = keyOf(folder), l = this.lists[slug];
    cx.spawn(async (cx) => this.write(slug, folder, l?.items ?? [], cx, l?.skipped ?? [], { ...(l?.opts ?? defOpts()), [key]: on, set: { ...(l?.opts?.set ?? {}), [key]: true } }));
  }

  // Whether agents know about the lists: the rule in Claude Code's CLAUDE.md.
  checkRule(cx) {
    readTextFile(`${home()}/.claude/CLAUDE.md`).then((text) => {
      const ok = (text ?? "").includes("<!-- over9k:todo -->");
      if (ok !== this.ruleOk) { this.ruleOk = ok; cx.notify(); }
    }).catch(() => { if (this.ruleOk) { this.ruleOk = false; cx.notify(); } });
  }

  // Sets agents up: the rule, the `todo` command and Claude Code's hook
  // (setup.sh: this mod's own copy, else Over9k Options').
  setUpAgents(cx) {
    const mods = `${appHome().replace(/\\/g, "/")}/mods`;
    cx.spawn(async (cx) => {
      let r = await exec("sh", [`${mods}/over9k-todos/setup.sh`, "todo", "on", mods]).catch(() => null);
      if (r?.code === 127 || r == null || /No such file|can't open/i.test(r?.stderr ?? "")) r = await exec("sh", [`${mods}/over9k-options/setup.sh`, "todo", "on", mods]).catch(() => null);
      notify(r?.code === 0
        ? { title: "Agents can use the to-do lists", body: "New agents get the rule and the todo command (~/.local/bin).", level: "info" }
        : { title: "Couldn't set up agents", body: (r?.stderr ?? "").trim() || "Needs sh (Git Bash on Windows).", level: "warning" });
      this.checkRule(cx);
    });
  }

  findHere(cx) {
    for (const s of spaces()) { const f = (s.folder ?? "").replace(/\/+$/, ""); if (s.machine && f) FOLDER_M.set(f, s.machine); }
    const f = focused(), s = spaces().find((x) => x.active);
    if (f?.agent || (f?.terminal && agents().some((a) => a.address === f.terminal))) this.lastAgent = f.agent ?? f.terminal;
    // A space on another computer: the project is worked out there, and its home
    // (printed second) counts as no project, as home does here.
    const m = s?.machine ?? null;
    const from = (f?.cwd || s?.folder || (m ? "" : home())).replace(/\/+$/, "");
    if (`${m}|${from}` === this.hereFrom) return;
    this.hereFrom = `${m}|${from}`;
    cx.spawn(async (cx) => {
      const r = from ? await exec("sh", ["-c", 'c=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); case "$c" in */.git) echo "${c%/.git}" ;; *) git -C "$1" rev-parse --show-toplevel 2>/dev/null || echo "$1" ;; esac; printf "%s\\n" "$HOME"', "sh", from], onM(m)).catch(() => null) : null;
      if (this.hereFrom !== `${m}|${from}`) return; // moved on meanwhile
      const [top, theirHome] = (r?.stdout ?? "").split("\n");
      let here = (top?.trim() || from).replace(/\/+$/, "") || null;
      if (m && (!here || here === (theirHome ?? "").trim().replace(/\/+$/, ""))) here = null;
      if (here === this.here && m === HERE.machine) return;
      this.here = here;
      HERE.folder = m ? here : null;
      HERE.machine = m && here ? m : null;
      if (HERE.folder) FOLDER_M.set(HERE.folder, HERE.machine);
      await this.loadThere(cx);
      cx.notify();
    });
  }

  name(folder) {
    if (isPersonal(folder)) return "Personal";
    if (folder === home()) return "~";
    return (shared("projects.names") ?? {})[folder] || folder.split("/").pop();
  }
  color(folder, t) {
    if (isPersonal(folder)) return t.accent;
    return folder === home() ? t.muted : hue(folder.split("/").pop());
  }

  async write(slug, folder, items, cx, skipped = this.lists[slug]?.skipped ?? [], opts = this.lists[slug]?.opts ?? defOpts()) {
    const path = slug === "personal" ? PFILE() : `${DIR()}/${slug}.md`, old = this.lists[slug]?.raw ?? null;
    const text = serialize(folder, items, skipped, opts);
    const m = machineOf(slug);
    if (m) {
      const r = await exec("sh", ["-c", THERE_WRITE, "sh", slugOf(folder), text, old ?? "", old != null ? "1" : ""], onM(m)).catch(() => null);
      if (r?.code !== 0) return this.loadRemote(cx); // changed there meanwhile: show theirs
      this.lists[slug] = { folder, items, skipped, opts, raw: text, machine: m };
      if (opts.sync) SYNCED.add(folder); else SYNCED.delete(folder);
      return cx.notify();
    }
    try {
      await writeTextFile(path, text, old);
      this.lists[slug] = { folder, items, skipped, opts, raw: text };
      if (opts.sync) SYNCED.add(folder); else SYNCED.delete(folder);
      if (slug === "personal") this.pushPersonal(cx);
    } catch {
      await this.load(cx); // an agent changed it meanwhile: show theirs
    }
    cx.notify();
  }

  // "#name" picks the project (a listed one with to-dos, a space's, or a
  // known project's name), else the one you're in.
  projectFor(tag) {
    const want = tag.toLowerCase();
    const known = [...Object.values(this.lists).map((l) => l.folder), ...spaces().map((s) => (s.folder ?? "").replace(/\/+$/, "")),
      ...Object.keys(shared("projects.names") ?? {}), ...(shared("projects.pinned") ?? []), ...(shared("projects.auto") ?? [])].filter(Boolean);
    const match = (f) => [this.name(f), f.split("/").pop()].map((x) => x.toLowerCase());
    return known.find((f) => match(f).includes(want)) ?? known.find((f) => match(f).some((x) => x.startsWith(want))) ?? null;
  }

  // The project's TODO.md items (read once per folder, again every 15s).
  readFile(folder, cx) {
    if (!folder || Date.now() - (this.fileAt[folder] ?? 0) < 15000) return;
    this.fileAt[folder] = Date.now();
    this.fromFile[folder] ??= { file: null, items: [] };
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", TODO_FILE, "sh", folder], onM(mOf(folder))).catch(() => null);
      const out = r?.stdout ?? "", nl = out.indexOf("\n");
      const next = nl > 0 ? { file: out.slice(0, nl), items: fileItems(out.slice(nl + 1)) } : { file: null, items: [] };
      const was = this.fileStale[folder];
      this.fileStale[folder] = false;
      if (was || JSON.stringify(next) !== JSON.stringify(this.fromFile[folder])) { this.fromFile[folder] = next; cx.notify(); }
    });
  }

  // TODO.md items not on the list (open, done or hidden): the suggestions.
  suggested(folder) {
    const f = this.fromFile[folder];
    if (!f?.items.length || this.fileStale[folder]) return { file: f?.file, items: [] };
    const l = this.lists[keyOf(folder)];
    const have = new Set([...(l?.items ?? []).map((x) => x.text.toLowerCase()), ...(l?.skipped ?? []).map((x) => x.toLowerCase())]);
    return { file: f.file, items: f.items.filter((x) => !have.has(x.toLowerCase())) };
  }

  take(folder, texts, cx) {
    const slug = keyOf(folder), l = this.lists[slug];
    cx.spawn(async (cx) => this.write(slug, folder, [...(l?.items ?? []), ...texts.map((text) => ({ done: false, doing: false, text, due: null, doneOn: null }))], cx));
  }

  // All, or only the project you're in (kept for next time); picks are dropped.
  setMode(mode) {
    this.mode = mode;
    this.proj = null;
    try { localStorage.setItem("todos.mode", mode); } catch {}
    this.unpick();
  }

  // A project's chip: filter to it (again: back to the mode's own view).
  pickProject(slug) { this.proj = this.proj === slug ? null : slug; }

  // A TODO.md suggestion's ×: the line goes from TODO.md itself (gone from here at once).
  dropFromFile(folder, text, cx) {
    const f = this.fromFile[folder];
    if (f) this.fromFile[folder] = { ...f, items: f.items.filter((x) => x !== text) };
    cross(folder, "rm", text);
    this.fileAt[folder] = 0;
    cx.notify();
  }

  skip(folder, text, cx) {
    const slug = keyOf(folder), l = this.lists[slug];
    cx.spawn(async (cx) => this.write(slug, folder, l?.items ?? [], cx, [...(l?.skipped ?? []), text]));
  }

  // A TODO.md suggestion straight to an agent: on the list first, then started.
  startFromFile(a, folder, text, cx, running = null) {
    this.take(folder, [text], cx);
    if (running) this.sendTo(running, { text, folder, due: null });
    else this.startAgent(a, { text, folder, due: null });
  }

  // What an agent is told for to-do `x` (or several).
  taskFor(x) {
    const xs = [x].flat(), when = (y) => (y.due ? ` (due ${dueWords(y.due)})` : "");
    const tick = (y) => `\`todo done "${y.text.replace(/"/g, '\\"')}"\``;
    if (xs.length === 1) return `Work on this one to-do from the project's list, and only this one: ${xs[0].text}${when(xs[0])}\n\nWhen it's finished, tick it: ${tick(xs[0])}.`;
    return `Work on these to-dos from the project's list, and only these:\n\n${xs.map((y, i) => `${i + 1}. ${y.text}${when(y)}`).join("\n")}\n\nTick each one once it's finished: ${xs.map(tick).join(", ")}.`;
  }

  // The picked to-dos as they are now (by their text: an agent may have moved them).
  picked() {
    return [...this.sel].map(([key, text]) => {
      const [slug, i] = [key.slice(0, key.lastIndexOf(":")), +key.slice(key.lastIndexOf(":") + 1)], l = this.lists[slug];
      const x = l?.items[i];
      return x && x.text === text ? { ...x, slug, i, folder: l.folder } : null;
    }).filter(Boolean);
  }

  // Shift+click picks every to-do from the last picked one to this one (as
  // shown); Cmd/Meta or Ctrl+click adds or drops one.
  pick(x, e, cx) {
    const key = `${x.slug}:${x.i}`, order = this.visible ?? [];
    const from = order.findIndex((y) => `${y.slug}:${y.i}` === this.anchor), to = order.findIndex((y) => `${y.slug}:${y.i}` === key);
    if (e?.modifiers?.shift && from >= 0 && to >= 0) {
      if (!(e.modifiers.platform || e.modifiers.control)) this.sel.clear();
      order.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((y) => this.sel.set(`${y.slug}:${y.i}`, y.text));
    } else {
      this.sel.has(key) ? this.sel.delete(key) : this.sel.set(key, x.text);
      this.anchor = key;
    }
    if (!this.sel.size && this.startFor === "sel") this.startFor = null;
    cx.notify();
  }
  unpick() { this.sel.clear(); this.anchor = null; if (this.startFor === "sel") this.startFor = null; this.pickOpen = false; }

  // Ticks the picked ones (or unticks them, when they're all ticked already).
  tickPicked(cx) {
    const xs = this.picked(), on = xs.some((x) => !x.done);
    for (const slug of new Set(xs.map((x) => x.slug))) {
      const at = new Set(xs.filter((x) => x.slug === slug).map((x) => x.i));
      this.change(slug, (items) => items.map((y, j) => (at.has(j) && y.done !== on ? { ...y, done: on, doing: on ? false : y.doing, doneOn: on ? stamp() : null } : y)), cx);
    }
    for (const x of xs) if (x.done !== on) { cross(x.folder, on ? "done" : "undo", x.text); this.fileAt[x.folder] = 0; }
    this.unpick();
  }

  deletePicked(cx) {
    const xs = this.picked();
    for (const slug of new Set(xs.map((x) => x.slug))) {
      const at = new Set(xs.filter((x) => x.slug === slug).map((x) => x.i));
      this.change(slug, (items) => items.filter((_, j) => !at.has(j)), cx);
    }
    for (const x of xs) toFile(x.folder, "rm", x.text);
    this.unpick();
  }

  // Agents already running in a project (their pane's folder in it), the one
  // you were last in first.
  runningIn(folder) {
    if (!folder) return [];
    const ps = panes();
    return agents().filter((a) => {
      const c = (ps.find((p) => p.terminal === a.address)?.cwd ?? "").replace(/\/+$/, "");
      return c === folder || c.startsWith(folder + "/");
    }).sort((a, b) => (b.address === this.lastAgent) - (a.address === this.lastAgent));
  }

  // What the sidebar calls an agent: a name given to its tab, else its
  // conversation's (agent-name.js, as over9k), else the program.
  agentName(a) {
    const p = panes().find((x) => x.terminal === a.address);
    const tab = spaces().flatMap((s) => s.tabs ?? []).find((t) => t.id === p?.tab);
    const named = tab && !/^(\d+|tb?[0-9a-z]+)$/.test(tab.name) && tab.name !== a.program?.name ? tab.name : "";
    return named || agentTask(a, p?.cwd) || a.tab_name || a.program?.name || "Agent";
  }

  // To-do `x` to agent `a` that's already running: into its conversation, shown.
  sendTo(a, x) {
    this.startFor = null;
    const xs = [x].flat();
    hc(["send", a.address, this.taskFor(xs)]).catch(() => null);
    run("pane.focus", { terminal: a.address });
    notify({ title: `Sent to ${a.tab_name || a.program?.name || "the agent"}`, body: xs.map((y) => y.text).join("\n"), level: "info" });
  }

  // Starts agent `a` on to-do `x` in its project's space (made if needed).
  // Several to-dos (all of one project): one agent on them all.
  startAgent(a, x) {
    this.startFor = null;
    const xs = [x].flat(), folder = xs[0].folder, task = this.taskFor(xs);
    const first = xs.length > 1 ? `${xs.length} to-dos` : xs[0].text;
    const name = first.length > 28 ? `${first.slice(0, 27)}\u2026` : first;
    const m = mOf(folder);
    const there = spaces().find((s) => (s.machine ?? null) === m && (s.folder ?? "").replace(/\/+$/, "") === folder);
    if (there) run("tab.new", { space: there.id, name, folder, argv: a.run, task });
    else run("space.new", { name: this.name(folder), folder, tab: name, argv: a.run, task, machine: m ?? "" });
    if (there && !there.active) run("space.select", { id: there.id });
    notify({ title: `${a.name} is on it`, body: xs.map((y) => y.text).join("\n"), level: "info" });
  }

  // The picked open to-dos to agents: one already running (when they're all
  // one project's), or a new one per project.
  sendPicked(a, target) {
    const xs = this.picked().filter((x) => !x.done);
    if (!xs.length) return;
    if (target) this.sendTo(target, xs);
    else for (const f of new Set(xs.map((x) => x.folder))) this.startAgent(a, xs.filter((x) => x.folder === f));
    this.unpick();
  }

  // Projects to offer after "#": ones with to-dos, open spaces, listed projects.
  projectChoices(t) {
    const folders = [...new Set([...Object.values(this.lists).map((l) => l.folder), ...spaces().map((s) => (s.folder ?? "").replace(/\/+$/, "")),
      ...(shared("projects.pinned") ?? []), ...(shared("projects.auto") ?? [])].filter((f) => f && f !== home()))];
    const hereFirst = (f) => (f === this.here ? 0 : this.lists[keyOf(f)]?.items.some((x) => !x.done) ? 1 : 2);
    return folders.sort((a, b) => hereFirst(a) - hereFirst(b) || this.name(a).localeCompare(this.name(b)))
      .map((f) => ({ key: f.split("/").pop(), name: this.name(f), color: this.color(f, t) }));
  }

  accept(cx) {
    const s = this.sugs?.[this.sugAt];
    if (!s) return;
    const value = this.input.value().replace(/\S*$/, "") + s.insert + " ";
    this.input.set_value(value);
    this.input.set_selected_range?.({ start: value.length, end: value.length });
    this.typed = value;
    this.sugAt = 0;
    cx.notify();
  }

  add(typed, cx) {
    let text = typed.trim();
    if (!text) return;
    // No "#project": yours (Personal). A picked chip or "#tag" still wins.
    let folder = this.filter ? this.lists[this.filter]?.folder ?? PERSONAL() : PERSONAL();
    const tag = /(?:^|\s)#([\w.-]+)/.exec(text);
    if (tag) { const f = this.projectFor(tag[1]); if (f) { folder = f; text = (text.slice(0, tag.index) + text.slice(tag.index + tag[0].length)).replace(/\s+/g, " ").trim(); } }
    if (!folder) return;
    const { text: rest, due } = takeDue(text);
    if (!rest) return;
    const slug = keyOf(folder), l = this.lists[slug];
    this.input.set_value("");
    this.typed = "";
    cx.spawn(async (cx) => this.write(slug, folder, [...(l?.items ?? []), { done: false, doing: false, text: rest, due, doneOn: null }], cx));
    toFile(folder, "add", rest);
  }

  change(slug, fn, cx) {
    const l = this.lists[slug];
    if (!l) return;
    const items = fn(l.items.map((x) => ({ ...x })));
    cx.spawn(async (cx) => this.write(slug, l.folder, items, cx));
  }

  saveEdit(cx) {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const { text, due } = takeDue(this.editInput.value().trim());
    const was = this.lists[e.slug]?.items[e.i], folder = this.lists[e.slug]?.folder;
    if (was && folder && text !== was.text) toFile(folder, ...(text ? ["rename", was.text, text] : ["rm", was.text]));
    this.change(e.slug, (items) => (text ? items.map((x, i) => (i === e.i ? { ...x, text, due: due ?? x.due } : x)) : items.filter((_, i) => i !== e.i)), cx);
  }

  render(cx) {
    const t = theme();
    const hereSlug = this.here && keyOf(this.here);
    // Only pinned projects (the sidebar's list), and the one you're in.
    // All: the projects Over9k's sidebar pins, and the one you're in; without
    // that sidebar (this panel on its own), every project's list.
    const pinList = shared("projects.pinned");
    const pinned = new Set((pinList ?? []).map((f) => f.replace(/\/+$/, "")));
    const hereOk = Boolean(this.here && this.here !== home());
    const inScope = (l) => l.machine || isPersonal(l.folder) || !Array.isArray(pinList) || pinned.has(l.folder) || (hereOk && l.folder === this.here);
    if (this.proj && !this.lists[this.proj]) this.proj = null;
    this.filter = this.proj ?? (this.mode === "here" && hereOk ? hereSlug : null);
    const all = Object.entries(this.lists).filter(([, l]) => inScope(l)).flatMap(([slug, l]) => l.items.map((x, i) => ({ ...x, slug, i, folder: l.folder })));
    const open = all.filter((x) => !x.done && !x.doing), doings = all.filter((x) => x.doing && !x.done), doneToday = all.filter((x) => x.done).sort((a, b) => (b.doneOn ?? "").localeCompare(a.doneOn ?? ""));
    // A chip per project with to-dos (the one you're in has its own): its
    // open count, so an all-done project still gets one to look back at.
    const bySlug = {};
    for (const x of all) { const b = bySlug[x.slug] ??= { open: 0, n: 0 }; b.n++; if (!x.done) b.open++; }
    const projects = Object.keys(bySlug).filter((s) => s !== "personal" && !(hereOk && s === hereSlug))
      .map((s) => { const l = this.lists[s], m = machineOf(s); return { slug: s, folder: l.folder, label: `${m ? `${m}/` : ""}${this.name(l.folder)}`, n: bySlug[s].open, color: this.color(l.folder, t) }; })
      .sort((a, b) => a.label.localeCompare(b.label));
    // Personal (~/.todo) is yours, not a project's: its chip always shows.
    projects.unshift({ slug: "personal", folder: PERSONAL(), label: "Personal", n: bySlug.personal?.open ?? 0, color: t.accent });
    const hereOpen = hereOk ? (this.lists[hereSlug]?.items ?? []).filter((x) => !x.done).length : 0;
    const shown = (list) => list.filter((x) => !this.filter || x.slug === this.filter);
    const dueKey = (x) => (x.due ? x.due.padEnd(16, " ") : "~");
    const list = shown(open).sort((a, b) => (b.slug === hereSlug) - (a.slug === hereSlug) || dueKey(a).localeCompare(dueKey(b)) || a.slug.localeCompare(b.slug) || a.i - b.i);
    const doingList = shown(doings).sort((a, b) => (b.slug === hereSlug) - (a.slug === hereSlug) || dueKey(a).localeCompare(dueKey(b)) || a.slug.localeCompare(b.slug) || a.i - b.i);
    const done = shown(doneToday);
    this.visible = [...doingList, ...list, ...done];
    const picks = this.picked();
    if (picks.length !== this.sel.size) { this.sel = new Map(picks.map((x) => [`${x.slug}:${x.i}`, x.text])); if (!picks.length) this.unpick(); }
    const now = new Date();
    const focusFolder = this.filter ? this.lists[this.filter]?.folder ?? this.here : this.here;
    if (focusFolder) this.readFile(focusFolder, cx);
    const fromFile = focusFolder ? this.suggested(focusFolder) : { items: [] };
    this.sugs = this.typed && this.typed !== this.sugOff ? suggest(this.typed, this.projectChoices(t)) : [];
    if (this.sugAt >= this.sugs.length) this.sugAt = 0;

    // A filter tab, as the sidebar's All / Agents: plain text, the picked one
    // shaded; a project's name in its colour, its count, and a small Log and
    // Sync icon when they're on.
    const chip = (key, label, n, color, on, fn, folder) => {
      const o = folder ? this.lists[keyOf(folder)]?.opts ?? defOpts() : null;
      return h_flex().id(`chip-${key}`).h(20).px(7).gap(4).flex_none().items_center().rounded(5).cursor_pointer()
        .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { fn(); this.unpick(); cx.notify(); })
        .child(div().text_color(color ?? (on ? t.foreground : t.muted)).child(label))
        .when(n != null, (el) => el.child(div().text_color(t.dim).child(String(n))))
        .when(Boolean(o?.log), (el) => el.child(svg("mods/over9k-todos/log.svg").size(10).flex_none().text_color(t.dim)))
        .when(Boolean(o?.sync), (el) => el.child(svg("mods/over9k-todos/sync.svg").size(10).flex_none().text_color(t.dim)));
    };

    // A to-do, as the sidebar's agent rows: its circle, the text on one line
    // (all of it on hover, or double-click to edit), and on the right when it's
    // due or was done; on hover, the agent and delete buttons.
    const row = (x) => {
      const key = `${x.slug}:${x.i}`, editing = this.editing?.slug === x.slug && this.editing.i === x.i, c = this.color(x.folder, t);
      const on = this.sel.get(key) === x.text, hovered = this.hover === key;
      const meta = x.done ? (x.doneOn ? doneWords(x.doneOn) : "") : x.due ? dueWords(x.due) : "";
      return h_flex().id(`todo-${key}`).min_h(30).px(8).gap(8).items_center().rounded(8)
        .when(on, (el) => el.bg(t.accent + "38")).hover((s) => s.bg(on ? t.accent + "38" : t.hover))
        .on_click((e, cx) => { if (multi(e) && !editing && this.filter) this.pick(x, e, cx); })
        .on_hover((on, cx) => { this.hover = on ? key : this.hover === key ? null : this.hover; cx.notify(); })
        .child(div().id(`tick-${key}`).size(14).flex_none().rounded(7).border(1.5).cursor_pointer().border_color(c)
          .when(x.done, (el) => el.bg(c).flex().items_center().justify_center().child(svg("mods/workspace-chrome/check.svg").size(9).text_color(t.background)))
          .when(x.doing && !x.done, (el) => el.bg(t.working).flex().items_center().justify_center().child(div().text_size(10).font_semibold().text_color(t.background).child("~")))
          .on_click((e, cx) => {
            if (multi(e) && this.filter) return; // the row picks it
            this.change(x.slug, (items) => items.map((y, j) => (j === x.i ? { ...y, done: !y.done, doing: false, doneOn: y.done ? null : stamp() } : y)), cx);
            // Crossed out (or back in) in the project's own TODO.md too, if it lists it.
            cross(x.folder, x.done ? "undo" : "done", x.text);
            this.fileAt[x.folder] = 0;
          }))
        .child(editing
          ? Input.new(this.editInput).flex_1().h(24).px(6).rounded(5).border_1().border_color(t.accent).bg(t.background).text_size(13).text_color(t.foreground)
          : div().id(`text-${key}`).flex_1().min_w(0).text_size(13).line_height("18px").text_color(x.done ? t.dim : t.foreground)
            .when(!hovered, (el) => el.truncate()).when(hovered, (el) => el.whitespace_normal().py(5))
            .on_click((e, cx) => { if (e.click_count === 2 && !multi(e)) { this.editing = { slug: x.slug, i: x.i }; this.editInput.set_value(x.text + (x.due ? ` @${fmtDate(new Date(`${x.due.split(" ")[0]}T00:00:00`))}${x.due.includes(" ") ? ` ${fmtTime(x.due.split(" ")[1])}` : ""}` : "")); this.editInput.focus(); cx.notify(); } })
            .child(x.text))
        .when(Boolean(meta) && !editing && !(hovered && !x.done), (el) => el.child(div().flex_none().text_size(11).text_color(!x.done && overdue(x.due) ? t.ansi1 : t.dim).child(meta)))
        // In All, its project's name, in its colour, last so every row's lines up
        // on the right (the tabs above filter by it).
        .when(!this.filter && !editing && !(hovered && !x.done), (el) => el.child(div().flex_none().max_w(110).truncate().text_right().text_size(11).text_color(c).child(machineOf(x.slug) ? `${machineOf(x.slug)}/${this.name(x.folder)}` : this.name(x.folder))))
        .when(hovered && !editing && !x.done, (el) => el.child(div().id(`doing-${key}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.raised)).tooltip(x.doing ? "Back to to-do" : "Doing")
          .on_click((_e, cx) => { this.change(x.slug, (items) => items.map((y, j) => (j === x.i ? { ...y, doing: !y.doing } : y)), cx); })
          .child(svg("mods/workspace-chrome/clock.svg").size(11).text_color(x.doing ? t.working : t.muted))))
        .when((hovered || this.startFor === key) && !editing && !x.done && this.agentChoices.length > 0, (el) => el.child(div().id(`start-${key}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .when(this.startFor === key, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.raised)).on_click((_e, cx) => { this.pickOpen = false; this.startFor = this.startFor === key ? null : key; cx.notify(); })
          .child(svg("mods/over9k-todos/bot.svg").size(12).text_color(t.muted))))
        .when(hovered && !editing, (el) => el.child(div().id(`del-${key}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.raised)).on_click((_e, cx) => { this.change(x.slug, (items) => items.filter((_, j) => j !== x.i), cx); toFile(x.folder, "rm", x.text); })
          .child(svg("mods/workspace-chrome/x.svg").size(11).text_color(t.muted))));
    };
    // A section, as the sidebar's Parked: a chevron that folds it, its name and
    // count, and an action on the right. With a tone it's a band header: bigger,
    // semibold, colored, its count a pill (To-do / Done stand out from the rows).
    const section = (id, label, n, open, toggleFn, right, tone) => h_flex().id(`sec-${id}`)
      .h(tone ? 34 : 26).flex_none().mt(tone ? 12 : 6).px(tone ? 4 : 8).gap(tone ? 8 : 7).items_center()
      .text_size(tone ? 13 : 11).text_color(tone?.color ?? t.dim).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(Boolean(tone), (el) => el.font_semibold())
      .on_click((_e, cx) => { toggleFn(); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(tone ? 12 : 11).flex_none().text_color(tone?.color ?? t.dim))
      .child(div().child(label))
      .child(tone
        ? div().h(18).px(6).flex_none().rounded(9).flex().items_center().justify_center().text_size(11).bg(tone.color + "26").text_color(tone.color).child(String(n))
        : div().text_color(t.muted).child(String(n)))
      .child(div().flex_1())
      .when(Boolean(right) && open, (el) => el.child(right));
    // Under a to-do whose ▶ was clicked: an agent per button.
    // Under a to-do whose agent button was clicked, two choices: Send to this
    // agent (the one you were last in, else the latest one in that project), or
    // New agent, of the kind the pill shows (click it to pick; kept for next time).
    const icon = (a, size = 13) => (a?.icon ? (a.tint ? svg(a.icon).size(size).flex_none().text_color(t.foreground) : image(a.icon).w(size).h(size).flex_none())
      : svg("mods/over9k-todos/bot.svg").size(size).flex_none().text_color(t.muted));
    const option = (id, fn, kids) => h_flex().id(id).h(26).px(7).gap(7).items_center().rounded(5).cursor_pointer()
      .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { fn(cx); cx.notify(); }).children(kids);
    // Under a to-do whose agent button was clicked: Current conversation, each
    // agent already running in that project by the name the sidebar gives it
    // (its icon and status dot), then New conversation, of the kind its pill
    // shows (click the pill to pick; kept for next time).
    const starter = (x, go) => {
      const running = this.runningIn(x.folder).slice(0, 4), make = go ?? ((a) => this.startAgent(a, x));
      const pick = this.agentChoices.find((a) => a.key === this.newPick) ?? this.agentChoices[0];
      const label = (text) => div().px(7).pt(4).pb(1).text_size(10.5).text_color(t.dim).child(text);
      const kind = (a) => this.agentChoices.find((c) => c.key === a.program?.key || c.key === a.app);
      return v_flex().relative().ml(30).mr(6).mb(6).p(3).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover)
        // × closes it (as does the agent button again).
        .child(div().id("starter-close").absolute().top(4).right(4).size(18).flex().items_center().justify_center().rounded(4).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip("Close")
          .on_click((_e, cx) => { this.startFor = null; this.pickOpen = false; cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted)))
        .when(running.length > 0, (el) => el.child(label(running.length > 1 ? "Current conversations" : "Current conversation"))
          .children(running.map((r) => option(`send-${r.address}`, (cx) => (go ? go(null, cx, r) : this.sendTo(r, x)), [
            icon(kind(r), 13),
            div().flex_1().min_w(0).truncate().child(this.agentName(r)),
            div().size(6).flex_none().rounded(3).bg(t[r.status] ?? t.idle),
          ]))))
        .when(Boolean(pick), (el) => el.child(label("New conversation"))
          .child(option("new", (cx) => make(pick, cx), [
            div().size(13).flex_none().flex().items_center().justify_center().text_size(14).text_color(t.muted).child("+"),
            div().flex_1().child("Start a new one"),
            h_flex().id("new-pick").h(20).px(6).gap(4).flex_none().items_center().rounded(5).border_1().border_color(this.pickOpen ? t.accent : t.border)
              .text_size(11).text_color(t.muted).hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); this.pickOpen = !this.pickOpen; cx.notify(); })
              .child(icon(pick, 11)).child(pick?.name ?? "").child(svg(`mods/workspace-chrome/chevron-${this.pickOpen ? "right" : "down"}.svg`).size(8)),
          ])))
        .when(Boolean(this.pickOpen), (el) => el.child(v_flex().ml(20).pt(1).border_t_1().border_color(t.border)
          .children(this.agentChoices.map((a) => option(`pick-${a.key}`, () => { this.newPick = a.key; this.pickOpen = false; }, [
            icon(a, 12), div().flex_1().text_size(11.5).child(a.name),
            ...(a.key === pick?.key ? [svg("mods/workspace-chrome/check.svg").size(10).flex_none().text_color(t.accent)] : []),
          ])))));
    };
    // The picked ones, as a bar under the add box: how many, then plain labelled
    // actions (as the sidebar's buttons: no borders, shaded on hover): Mark done
    // (Mark not done when all are), Send to agent (open ones; the agent card
    // under the bar), Delete (click twice), Cancel.
    const pickBar = () => {
      const open = picks.filter((x) => !x.done), folders = new Set(open.map((x) => x.folder));
      const allDone = picks.every((x) => x.done);
      const act = (id, icon, label, fn, color, share) => h_flex().id(id).h(24).px(6).gap(5).items_center().rounded(5).cursor_pointer().text_size(12)
        .flex_none()
        .text_color(color ?? t.muted).hover((s) => s.bg(t.hover).text_color(color ?? t.foreground))
        .on_click((_e, cx) => { fn(cx); cx.notify(); })
        .when(Boolean(icon), (el) => el.child(svg(icon).size(12).flex_none())).child(label);
      const many = folders.size > 1, target = many ? null : this.runningIn([...folders][0])[0];
      return v_flex().px(8).pb(4).gap(4)
        // Top: how many, and Cancel on the right; below: the three actions.
        .child(v_flex().px(6).py(4).gap(2).rounded(8).bg(t.accent + "26")
          .child(h_flex().h(24).items_center()
            .child(div().flex_1().min_w(0).px(4).text_size(12).text_color(t.foreground).child(`${picks.length} selected`))
            .child(act("pick-clear", null, "Cancel", () => this.unpick(), t.dim)))
          .child(h_flex().flex_wrap().justify_between().gap(2).items_center()
          .child(act("pick-tick", "mods/workspace-chrome/check.svg", allDone ? "Mark not done" : "Mark done", (cx) => this.tickPicked(cx), null, true))
          .when(open.length > 0 && this.agentChoices.length > 0, (el) => el.child(act("pick-send", "mods/over9k-todos/bot.svg", "Send to agent", () => { this.pickOpen = false; this.startFor = this.startFor === "sel" ? null : "sel"; }, null, true)))
          .child(act("pick-del", "mods/workspace-chrome/x.svg", this.delArmed ? `Delete ${picks.length}? Click again` : "Delete", (cx) => {
            if (this.delArmed) { this.delArmed = false; return this.deletePicked(cx); }
            this.delArmed = true; cx.spawn(async (cx) => { await cx.sleep(3000); this.delArmed = false; cx.notify(); });
          }, this.delArmed ? t.ansi1 : null, true))))
        .when(this.startFor === "sel" && open.length > 0, (el) => el.child(
          starter({ ...open[0], folder: many ? null : open[0].folder }, (a, _cx, to) => this.sendPicked(a, to)).ml(0).mr(0).mb(0)))
        .when(this.startFor === "sel" && many, (el) => el.child(div().px(4).text_size(11).text_color(t.dim).child(`A new agent in each of the ${folders.size} projects`)));
    };
    const withStarter = (x) => [row(x), ...(this.startFor === `${x.slug}:${x.i}` ? [starter(x)] : [])];

    // A project switch, as the usage rows' plan badges ("Ultra", "Free"): a small
    // tag with its icon (the one the tabs show when it's on) and name; shaded with
    // the name in the accent when on, plain and dim when off. A click switches it;
    // hover says what it does.
    const toggle = (id, label, icon, on, tip, fn) => h_flex().id(`switch-${id}`).px(5).py(1).gap(4).flex_none().items_center().rounded(4).cursor_pointer()
      .text_size(10.5).when(on, (el) => el.bg(t.raised).text_color(t.accent)).when(!on, (el) => el.text_color(t.dim))
      .hover((s) => s.bg(t.hover).text_color(on ? t.accent : t.foreground))
      .tooltip(`${tip} (${on ? "on" : "off"}: click to turn ${on ? "off" : "on"})`)
      .on_click((_e, cx) => { fn(cx); cx.notify(); })
      .child(svg(icon).size(10).flex_none()).child(label);
    return v_flex().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("To-do"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${open.length} open`))
        .child(div().flex_1())
        // Log and Sync for the project you're in (whichever tab shows).
        .when(hereOk, (el) => {
          const l = this.lists[hereSlug] ?? { folder: this.here, opts: defOpts() }, o = l.opts, n = this.name(this.here);
          return el.child(toggle("log", "Log", "mods/over9k-todos/log.svg", o.log, `Log (${n}): agents add what you ask for to its list${o.sync ? " and TODO.md" : ""}`, (cx) => this.setOpt(l.folder, "log", !o.log, cx)))
            .child(toggle("link", "Sync", "mods/over9k-todos/sync.svg", o.sync, `Sync (${n}): its TODO.md follows the list`, (cx) => this.setOpt(l.folder, "sync", !o.sync, cx)));
        }))
      .child(h_flex().flex_wrap().min_h(30).gap(2).px(8).pt(5).items_center().text_size(11.5)
        // The project you're in first, then a chip per project with open
        // to-dos, then All.
        .when(hereOk, (el) => el.child(chip("here", this.name(this.here), hereOpen || null, this.color(this.here, t), this.filter === hereSlug, () => this.setMode("here"))))
        .children(projects.map((p) => chip(`p-${p.slug}`, p.label, p.n, p.color, this.filter === p.slug, () => this.pickProject(p.slug), p.folder)))
        .child(chip("all", "All", open.length, null, !this.filter, () => this.setMode("all"))))
      .child(v_flex().px(8).pt(4).pb(4)
        .on_key_down((e, cx) => {
          if (!this.sugs.length) return;
          if (e.key === "down") this.sugAt = (this.sugAt + 1) % this.sugs.length;
          else if (e.key === "up") this.sugAt = (this.sugAt + this.sugs.length - 1) % this.sugs.length;
          else if (e.key === "tab") return this.accept(cx);
          else if (e.key === "escape") this.sugOff = this.typed;
          else return;
          cx.notify();
        })
        .child(Input.new(this.input).h(30).px(9).rounded(8).bg(t.raised).text_size(13).text_color(t.foreground))
        .when(this.sugs.length > 0, (el) => el.child(v_flex().mt(3).p(3).rounded(7).border_1().border_color(t.border).bg(t.popover)
          .children(this.sugs.map((g, i) => h_flex().id(`sug-${i}`).h(26).px(7).gap(7).items_center().rounded(5).cursor_pointer().text_size(12.5)
            .when(i === this.sugAt, (el) => el.bg(t.selected)).hover((x) => x.bg(t.hover))
            .on_click((_e, cx) => { this.sugAt = i; this.accept(cx); this.input.focus(); })
            .when(Boolean(g.color), (el) => el.child(div().size(6).flex_none().rounded(3).bg(g.color)))
            .child(div().flex_1().truncate().text_color(t.foreground).child(g.label))
            .when(Boolean(g.hint), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(g.hint))))))))
      .when(picks.length > 0, (el) => el.child(pickBar()))
      // Agents don't know about the lists yet: one click sets them up.
      .when(!this.ruleOk, (el) => el.child(h_flex().id("todo-setup").mx(8).mb(4).px(10).py(6).gap(8).items_center().rounded(8).cursor_pointer()
        .bg(t.accent + "1f").hover((s) => s.bg(t.accent + "33")).text_size(12).text_color(t.foreground)
        .on_click((_e, cx) => this.setUpAgents(cx))
        .child(svg("mods/over9k-todos/bot.svg").size(13).flex_none().text_color(t.accent))
        .child(div().flex_1().min_w(0).child("Let agents keep these lists"))
        .child(div().flex_none().text_size(11.5).text_color(t.accent).child("Set up"))))
      .child(v_flex().id("todo-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8)
        .child(section("todo", "To-do", list.length, !this.todoFolded, () => { this.todoFolded = !this.todoFolded; }, null, { color: t.accent }))
        .when(!this.todoFolded, (el) => el.children(list.flatMap(withStarter)))
        .when(!list.length, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim)
          .child(this.filter ? "Nothing left here" : `Nothing to do. New ones go to Personal (or pick a project with #).`)))
        // Doing: being worked on ([~] in the file); a row's clock button toggles it.
        .child(section("doing", "Doing", doingList.length, !this.doingFolded, () => { this.doingFolded = !this.doingFolded; }, null, { color: t.working }))
        .when(!this.doingFolded, (el) => el.children(doingList.flatMap(withStarter)))
        .when(fromFile.items.length > 0, (el) => el
          .child(section("file", `From ${fromFile.file}`, fromFile.items.length, !this.fileFolded, () => { this.fileFolded = !this.fileFolded; },
            div().id("take-all").px(5).rounded(4).cursor_pointer().hover((x) => x.bg(t.raised).text_color(t.foreground)).child("Add all")
              .on_click((_e, cx) => { cx.stop_propagation(); this.take(focusFolder, fromFile.items, cx); })))
          .children(this.fileFolded ? [] : fromFile.items.flatMap((text, i) => [h_flex().id(`file-${i}`).min_h(30).px(8).gap(8).items_center().rounded(8).hover((x) => x.bg(t.hover))
            .on_hover((on, cx) => { const k = `file:${i}`; this.hover = on ? k : this.hover === k ? null : this.hover; cx.notify(); })
            .child(div().id(`take-${i}`).size(14).flex_none().rounded(7).border_1().border_color(t.input).cursor_pointer()
              .flex().items_center().justify_center().hover((x) => x.border_color(this.color(focusFolder, t)))
              .child(svg("mods/workspace-chrome/plus.svg").size(9).text_color(t.muted))
              .on_click((_e, cx) => this.take(focusFolder, [text], cx)))
            .child(div().flex_1().min_w(0).text_size(13).line_height("18px").text_color(t.muted).when(this.hover !== `file:${i}`, (el) => el.truncate()).when(this.hover === `file:${i}`, (el) => el.whitespace_normal().py(5)).child(text))
            .when((this.hover === `file:${i}` || this.startFor === `file:${i}`) && this.agentChoices.length > 0, (el) => el.child(div().id(`fstart-${i}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
              .when(this.startFor === `file:${i}`, (el) => el.bg(t.selected))
              .hover((x) => x.bg(t.raised)).on_click((_e, cx) => { this.pickOpen = false; this.startFor = this.startFor === `file:${i}` ? null : `file:${i}`; cx.notify(); })
              .child(svg("mods/over9k-todos/bot.svg").size(12).text_color(t.muted))))
            .when(this.hover === `file:${i}`, (el) => el.child(div().id(`skip-${i}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
              .hover((x) => x.bg(t.raised)).tooltip(`Delete from ${fromFile.file ?? "TODO.md"}`).on_click((_e, cx) => this.dropFromFile(focusFolder, text, cx))
              .child(svg("mods/workspace-chrome/x.svg").size(11).text_color(t.muted)))),
            ...(this.startFor === `file:${i}` ? [starter({ text, folder: focusFolder }, (a, cx, running) => this.startFromFile(a, focusFolder, text, cx, running))] : [])])))
        // Done: all of them (the list scrolls), and Clear (twice) to delete
        // the ticked ones of the projects shown, as `todo clear`.
        .when(done.length > 0, (el) => el
          .child(section("done", "Done", done.length, !this.doneFolded, () => { this.doneFolded = !this.doneFolded; },
            div().id("done-clear").px(5).rounded(4).cursor_pointer().text_color(this.clearArmed ? t.ansi1 : t.dim).hover((s) => s.bg(t.raised).text_color(t.foreground))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                if (!this.clearArmed) { this.clearArmed = true; cx.spawn(async (cx) => { await cx.sleep(3000); this.clearArmed = false; cx.notify(); }); }
                else { this.clearArmed = false; for (const slug of new Set(done.map((x) => x.slug))) this.change(slug, (items) => items.filter((y) => !y.done), cx); }
                cx.notify();
              })
              .child(this.clearArmed ? `Clear ${done.length}?` : "Clear"),
            { color: t.done }))
          .children(this.doneFolded ? [] : done.map(row))));
  }
}
