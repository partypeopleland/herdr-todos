#!/bin/sh
# Per-project to-do lists, shared by people and agents (Over9k's To-do panel,
# mods/over9k-todos, shows and edits the same files).
#   todo                     this project's list, numbered
#   todo all                 every project's
#   todo add <text…>         add to this project's (--due "YYYY-MM-DD[ HH:MM]" first sets when)
#   todo done|undo <n|text>  tick or untick item n (or the one with that exact text)
#   todo doing|start <n|text> mark item n as being worked on; `todo open <n>` back to plain
#   todo edit <n|text> <new…> reword item n (its due and tick stay)
#   todo rm <n>              delete item n
#   todo clear               delete the ticked ones
#   todo log [on|off]        this project: agents add what you ask for (default: Options › To-do)
#   todo sync [on|off]       this project: its TODO.md follows add/edit/rm (default: Options › To-do)
#   todo --rule on|off       add or remove the agents' to-do rule (CLAUDE.md, AGENTS.md)
#   todo personal …          your own list, not a project's (~/.todo/todo-<machine>.md;
#                            lists other machines synced here show read-only)
# -p <folder> (first) picks the project; otherwise it's the git repo this runs in
# (its main checkout for a worktree), else this folder.
# Each list is ~/.local/share/over9k/todos/<slug>.md (DIR): a "<!-- folder: … -->"
# line, then "- [ ] text" / "- [x] text" lines (fine to edit by hand).
# Installed by Over9k's Options › To-do (or install.sh) as ~/.local/bin/todo, a
# small wrapper that runs this file (todo-cross.py is found next to it).
set -e
# The agents' rule (Options › To-do turns it on and off), between markers so it
# can be taken out again exactly: in CLAUDE.md, Codex's and Pi's AGENTS.md.
if [ "${1:-}" = --rule ]; then
  for f in "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"; do
    [ -d "$(dirname "$f")" ] || continue
    if [ -f "$f" ]; then
      tmp="$f.over9k.$$"
      sed '/<!-- over9k:todo -->/,/<!-- \/over9k:todo -->/d' "$f" | awk 'NF { for (; n > 0; n--) print ""; print; next } { n++ }' > "$tmp" && mv "$tmp" "$f"
    fi
    [ "${2:-}" = on ] && { [ -s "$f" ] && printf '\n'; cat <<'EOF'
<!-- over9k:todo -->
## Project to-do lists (Herdr)

Each project has a to-do list the user sees in Herdr's To-do panel and edits there
too. Use the `todo` command (it picks the project from the git repo you run it in):
`todo` lists it, `todo add <text>` adds, `todo done <n>` ticks, `todo rm <n>` deletes,
`todo all` shows every project's. While request logging is on
for that project
(`todo log` says; in Claude Code a note on each message says so), add each thing
the user asks for in a project (a change, a fix, a feature), even mid-task, as soon
as you read it, and tick it once it's done and checked; leave it open if it's only
partly done, and say so. When they change, narrow or drop a request, correct its
item instead of adding another: `todo edit <n> <new text>` rewords it, `todo rm <n>`
removes it. When they say to stop or start logging, run `todo log off` / `todo log on` (that project only). Also add an item when the user asks you to note something for later, or
when you leave follow-up work undone. Keep items short, one line each.
While you work on an item, mark it `todo doing <n>` (the panel's Doing section);
`todo done <n>` finishes it, `todo open <n>` returns it to plain to-do.
For the user's own non-project to-dos (personal errands, reminders), use
`todo personal` with the same subcommands — it is not tied to any repo; lists
synced there from other machines are read-only.
<!-- /over9k:todo -->
EOF
    } >> "$f"
  done
  exit 0
fi
# Where the lists live (the panel, main.js, uses the same folder).
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/over9k/todos"
# This script's own folder, through a symlink (todo-cross.py lives there).
SELF=$(readlink -f "$0" 2>/dev/null || printf %s "$0")
HERE=$(dirname "$SELF")
# Python 3 for todo-cross.py: python3, else python (as on Windows); none: no TODO.md sync.
PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)
dir=$DIR
mkdir -p "$dir"
folder=""
# This machine's id for ~/.todo/todo-<machine>.md: other machines' Herdr pushes
# their own file here (read-only; `todo personal` lists it, can't change it).
MACHINE=$(hostname 2>/dev/null | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g')
MACHINE=${MACHINE:-unknown}
PERS=""
# `todo personal …` is this machine's own list in ~/.todo.
if [ "$1" = "personal" ]; then shift; mkdir -p "$HOME/.todo"; PERS=1; set -- -p "$HOME/.todo" "$@"; fi
if [ "$1" = "-p" ]; then folder=$(cd "$2" && pwd); shift 2; fi
if [ -z "$folder" ]; then
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  case "$common" in */.git) folder=${common%/.git} ;; *) folder=$(git rev-parse --show-toplevel 2>/dev/null || pwd) ;; esac
fi
folder=${folder%/}
# A project's Log or Sync: its own "<!-- log|sync: on|off -->" line, else the
# default Over9k's Options › To-do writes to todo-defaults ("log on", "sync off").
DEFAULTS="${XDG_DATA_HOME:-$HOME/.local/share}/over9k/todo-defaults"
opt() {
  v=$(sed -n "s/^<!-- $1: \(on\|off\) -->\$/\1/p" "$file" 2>/dev/null | head -n 1)
  [ -n "$v" ] || v=$(sed -n "s/^$1 \(on\|off\)\$/\1/p" "$DEFAULTS" 2>/dev/null | head -n 1)
  [ -n "$v" ] || { [ "$1" = log ] && v=on || v=off; }
  [ "$v" = on ]
}
# Sync on (`todo sync on`): the project's TODO.md follows add, edit and rm.
md() { [ -n "$PY" ] && opt sync && "$PY" -I "$HERE/todo-cross.py" "$folder" "$@" 2>/dev/null || true; }
slug=$(printf %s "$folder" | sed 's/[^A-Za-z0-9][^A-Za-z0-9]*/-/g; s/^-//; s/-$//')
file="$dir/$slug.md"
# ~/.todo (however pwd spelled it) is the personal list: this machine's own
# file, todo-<machine>.md — synced copies of other machines' keep their names.
pslug=$(printf %s "$HOME/.todo" | sed 's/[^A-Za-z0-9][^A-Za-z0-9]*/-/g; s/^-//; s/-$//' | tr 'A-Z' 'a-z')
if [ "$(printf %s "$slug" | tr 'A-Z' 'a-z')" = "$pslug" ]; then file="$HOME/.todo/todo-$MACHINE.md"; fi

items() { [ -f "$1" ] && grep -E '^- \[( |x|~)\] ' "$1" || true; }
show() {
  f=$1; n=0
  items "$f" | while IFS= read -r l; do n=$((n + 1))
    due=$(printf %s "$l" | sed -n 's/.*<!-- due: \([^>]*\) -->.*/\1/p')
    on=$(printf %s "$l" | sed -n 's/.*<!-- done: \([^>]*\) -->.*/\1/p')
    text=$(printf %s "$l" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    case "$l" in "- [x] "*) box=x ;; "- [~] "*) box="~" ;; *) box=" " ;; esac
    printf '%3d. [%s] %s%s\n' "$n" "$box" "$text" "${due:+  (due $due)}${on:+  (done $on)}"
  done
}
# A synced personal list from another machine: shown, never numbered (can't be
# changed from here — it belongs to that machine).
showro() {
  items "$1" | while IFS= read -r l; do
    text=$(printf %s "$l" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    case "$l" in "- [x] "*) printf '    [x] %s\n' "$text" ;; "- [~] "*) printf '    [~] %s\n' "$text" ;; *) printf '    [ ] %s\n' "$text" ;; esac
  done
}
# Rewrites item $1 of this list with sed expression $2 (on that line only).
edit() {
  [ -f "$file" ] || { echo "No to-dos for $folder" >&2; exit 1; }
  line=$(grep -n -E '^- \[( |x|~)\] ' "$file" | sed -n "${1}p" | cut -d: -f1)
  [ -n "$line" ] || { echo "No item $1" >&2; exit 1; }
  sed "${line}$2" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
}

cmd=${1:-list}; [ $# -gt 0 ] && shift
case "$cmd" in
  list|ls)
    [ -n "$(items "$file")" ] && show "$file" || echo "No to-dos for $folder"
    # Personal: other machines' synced files, read-only (unnumbered on purpose).
    if [ -n "$PERS" ]; then
      for f in "$HOME/.todo"/todo-*.md; do
        [ -f "$f" ] && [ "$f" != "$file" ] || continue
        [ -n "$(items "$f")" ] || continue
        m=${f##*/todo-}; printf '%s\n' "— synced from ${m%.md} (read-only) —"; showro "$f"
      done
    fi ;;
  all)
    for f in "$dir"/*.md "$HOME/.todo/todo-$MACHINE.md"; do
      [ -f "$f" ] && [ -n "$(items "$f")" ] || continue
      printf '%s\n' "$(sed -n 's/^<!-- folder: \(.*\) -->$/\1/p' "$f" | head -n 1 | sed "s#^$HOME#~#")"; show "$f"
    done ;;
  add)
    due=""; if [ "$1" = "--due" ]; then due=$2; shift 2; fi
    text=$(printf '%s' "$*" | tr '\n' ' ' | sed 's/  *$//')
    [ -n "$text" ] || { echo "usage: todo add <text>" >&2; exit 2; }
    [ -f "$file" ] || printf '<!-- folder: %s -->\n' "$folder" > "$file"
    printf -- '- [ ] %s%s\n' "$text" "${due:+ <!-- due: $due -->}" >> "$file"
    md add "$text"
    echo "Added to $(printf %s "$folder" | sed "s#^$HOME#~#"): $text" ;;
  # Also crossed out (or back in) in the project's own TODO.md, if it lists it.
  done|check|undo|uncheck)
    n=${1:?item number or text}
    # The item's text works too: its number, from an exact match.
    case "$n" in *[!0-9]*) m=$(grep -E '^- \[( |x|~)\] ' "$file" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
      [ -n "$m" ] || { echo "No item \"$n\"" >&2; exit 1; }; n=$m ;; esac
    text=$(grep -E '^- \[( |x|~)\] ' "$file" 2>/dev/null | sed -n "${n}p" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    case "$cmd" in done|check) way=done ;; *) way=undo ;; esac
    "$0" -p "$folder" "_$way" "$n"
    [ -n "$text" ] && { [ -n "$PY" ] && "$PY" -I "$HERE/todo-cross.py" "$folder" "$way" "$text" 2>/dev/null; } || true ;;
  _done) edit "${1:?item number}" "s/^- \\[[ ~]\\] \\(.*\\)\$/- [x] \\1 <!-- done: $(date '+%F %H:%M') -->/" ;;
  _undo) edit "${1:?item number}" 's/^- \[x\] /- [ ] /; s/ *<!-- done: [^>]* -->//' ;;
  # Being worked on ([~]) or back to plain ([ ]): the panel's Doing section.
  doing|start)
    n=${1:?item number or text}
    case "$n" in *[!0-9]*) m=$(grep -E '^- \[( |x|~)\] ' "$file" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
      [ -n "$m" ] || { echo "No item \"$n\"" >&2; exit 1; }; n=$m ;; esac
    "$0" -p "$folder" "_doing" "$n" ;;
  open)
    n=${1:?item number or text}
    case "$n" in *[!0-9]*) m=$(grep -E '^- \[( |x|~)\] ' "$file" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
      [ -n "$m" ] || { echo "No item \"$n\"" >&2; exit 1; }; n=$m ;; esac
    "$0" -p "$folder" "_open" "$n" ;;
  _doing) edit "${1:?item number}" 's/^- \[[ x]\] /- [~] /; s/ *<!-- done: [^>]* -->//' ;;
  _open) edit "${1:?item number}" 's/^- \[[ x~]\] /- [ ] /; s/ *<!-- done: [^>]* -->//' ;;
  edit|reword)
    n=${1:?item number or text}; shift
    new=$(printf '%s' "$*" | tr '\n' ' ' | sed 's/  *$//')
    [ -n "$new" ] || { echo "usage: todo edit <n|text> <new text>" >&2; exit 2; }
    case "$n" in *[!0-9]*) m=$(grep -E '^- \[( |x|~)\] ' "$file" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
      [ -n "$m" ] || { echo "No item \"$n\"" >&2; exit 1; }; n=$m ;; esac
    old=$(grep -E '^- \[( |x|~)\] ' "$file" 2>/dev/null | sed -n "${n}p" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    [ -n "$old" ] || { echo "No item $n" >&2; exit 1; }
    # The new text, safe for sed's replacement (\, & and the | delimiter).
    esc=$(printf '%s' "$new" | sed 's/[\\&|]/\\&/g')
    edit "$n" "s|^\(- \[.\] \)[^<]*\(<!--.*\)\{0,1\}\$|\1$esc \2|; s| *\$||"
    md rename "$old" "$new"
    echo "Now: $new" ;;
  # A project switch: "<!-- log|sync: on|off -->" under the folder line.
  log|sync)
    case "${1:-}" in on|off) want="<!-- $cmd: $1 -->" ;; "") want=keep ;; *) echo "usage: todo $cmd [on|off]" >&2; exit 2 ;; esac
    if [ "$want" != keep ]; then
      [ -f "$file" ] || printf '<!-- folder: %s -->\n' "$folder" > "$file"
      grep -v "^<!-- $cmd: [a-z]* -->\$" "$file" | awk -v w="$want" '{ print } NR == 1 && w != "" { print w }' > "$file.tmp" && mv "$file.tmp" "$file"
    fi
    if [ "$cmd" = log ]; then opt log && echo "Request logging: on" || echo "Request logging: off"
    else opt sync && echo "TODO.md sync: on" || echo "TODO.md sync: off"; fi ;;
  rm|delete)
    text=$(grep -E '^- \[( |x|~)\] ' "$file" 2>/dev/null | sed -n "${1:?item number}p" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    edit "$1" 'd'
    [ -n "$text" ] && md rm "$text" ;;
  clear) [ -f "$file" ] && { grep -v -E '^- \[x\] ' "$file" > "$file.tmp"; mv "$file.tmp" "$file"; } ;;
  *) sed -n '2,14s/^# \{0,1\}//p' "$SELF"; exit 2 ;;
esac
