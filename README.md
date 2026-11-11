# Herdr To-do

A [Herdr](https://herdr.dev) mod that adds a **To-do** panel: per-project to-do lists shared between you and your coding agents, plus an optional `todo` shell CLI and agent-instruction hooks so agents log what you ask for.

## What it does

- **Per-project lists** — each project (git repo / folder) gets a Markdown list at `~/.local/share/over9k/todos/<slug>.md` (`$XDG_DATA_HOME/over9k/todos` when set), a `<!-- folder: … -->` line then `- [ ]` / `- [x]` items with optional `<!-- due: … -->` and `<!-- done: … -->` metadata. Safe to edit by hand.
- **Project chips** — one chip per project with open to-dos (coloured like the sidebar), an "All" scope, and a chip for the project you're currently in that follows you as you move.
- **Due dates** — type `@today`, `@fri`, `@nextweek`, `@in2h`, `@12nov`, `@4/11`, with an optional time (`@14:30`, `@fri 9am`); overdue items turn red.
- **TODO.md suggestions** — "From TODO.md" items from the project's own to-do file; ticking one here (or via `todo done`) crosses its line out there through `todo-cross.py`.
- **Remote machines** — spaces on other computers (`hc machine ls`) show their own lists, TODO.md and new-agent targets; remote state is read every 5 s.
- **Log / Sync toggles** — per-project switches in the header control whether agents add what you ask for (`todo log`) and whether the project's `TODO.md` follows edits (`todo sync`); unset projects follow the global defaults.
- **To-do / Done bands** — the list is folded into "To-do" and "Done today" sections.
- **Send to agent** — hover an item (or a TODO.md suggestion) for an agent picker that starts the chosen agent on just that to-do; multi-select (Shift / Ctrl / Cmd + click) supports mark-done, send, and delete.

## Install

Requirements: Herdr app, and `herdr-app` + `hc` on `PATH` (the panel reads remote machines through `hc`). The `todo` CLI and the agent hooks are **optional** — the panel alone works without them.

```powershell
./install.ps1
```

The installer copies `mod/` to `~/.config/herdr-app/mods/over9k-todos/` (backing up any existing copy under `~/.config/herdr-app/backups/herdr-todos/<timestamp>/`) and runs `herdr-app check`. It does **not** run `setup.sh` — that script is invasive (it edits global agent config files), so review it first.

To also get the `todo` command and agent request-logging, run from Git Bash after reading `mod/setup.sh`:

```sh
sh mod/setup.sh todo on "$HOME/.config/herdr-app/mods"   # run from the installed mods/over9k-todos folder
```

That installs a `~/.local/bin/todo` wrapper (plus `todo.cmd` on Windows so cmd/PowerShell can run it), adds the `<!-- over9k:todo -->` instruction block to agent global configs (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.pi/agent/AGENTS.md`), and registers a `UserPromptSubmit` hook so Claude Code nudges the agent to update the list on each message while `todo log` is on for that project. `setup.sh default log|sync on|off` sets the global defaults; `setup.sh check` reports missing dependencies (`git`, `jq`, `python3`).

## Use it in a layout

The mod is not part of Herdr's shipped layouts. Add a block to your layout (or a clone of `main`):

```json
{ "id": "todo", "type": "block", "content": { "mod": "over9k-todos" }, "size": { "px": 368 } }
```

`mod.json` already declares `place: "right"` / `size: 368` for UI-added placements. The mod registers no commands, so there is nothing to bind in `keys.json` — it's entirely self-contained.

## Files

| Path | Purpose |
| --- | --- |
| `mod/main.js` | The mod: panel UI, list parsing/watching, remote-machine polling, due-date parsing, agent actions |
| `mod/agent-name.js` | Task naming for agents started from the panel |
| `mod/mod.json` | Declared panel placement (`right`, 368 px) |
| `mod/jsconfig.json` | Editor types for the mod (`herdr`, `gpui-kit`) |
| `mod/todo.sh` | The `todo` CLI: `add` / `done` / `undo` / `edit` / `rm` / `clear` / `log` / `sync` / `--rule` / `all`, `-p <folder>` project picker |
| `mod/todo-hook.sh` | Claude Code `UserPromptSubmit` hook installed by `setup.sh` |
| `mod/todo-cross.py` | Crosses to-dos out of / back into a project's own `TODO.md` (needs `python3`, else `python`) |
| `mod/setup.sh` | Optional installer for the CLI, agent rule block and hook (`todo on\|off`, `default`, `check`) |
| `mod/*.svg` | Icons (project bot, Log and Sync switches) |

`gpui-kit.d.ts` is intentionally not shipped — the app writes its own copy into each mod folder.
