$ErrorActionPreference = 'Stop'

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }
if (-not (Test-Path -LiteralPath (Join-Path $appHome 'AGENTS.md'))) {
    throw "Herdr app home not found: $appHome"
}

$stamp = Get-Date -Format 'yyyyMMddHHmmssfff'
$backupRoot = Join-Path $appHome "backups\herdr-todos\$stamp"
$target = Join-Path $appHome 'mods\over9k-todos'
if (Test-Path -LiteralPath $target) {
    New-Item -ItemType Directory -Force -Path $backupRoot > $null
    Copy-Item -LiteralPath $target -Destination (Join-Path $backupRoot 'over9k-todos') -Recurse
}
New-Item -ItemType Directory -Force -Path $target > $null
Copy-Item -Path (Join-Path $PSScriptRoot 'mod\*') -Destination $target -Recurse -Force

# setup.sh installs the `todo` CLI wrapper and edits global agent instruction
# files — invasive, so it is NOT run here. Review mod/setup.sh and run it
# yourself (from Git Bash) if you want the CLI + agent request-logging:
#   sh mod/setup.sh todo on "$HOME/.config/herdr-app/mods"
"To also install the `todo` CLI and agent hooks, review and run mod/setup.sh yourself (see README)."

$checker = (Get-Command herdr-app -ErrorAction Stop).Source
$check = Start-Process -FilePath $checker -ArgumentList @('check', ('"' + $target + '"')) -Wait -PassThru -WindowStyle Hidden
if ($check.ExitCode -ne 0) { throw "over9k-todos mod check failed (exit $($check.ExitCode))" }

"Installed over9k-todos to $target"
"Add a block to a layout to use it, e.g. { `"id`": `"todo`", `"type`": `"block`", `"content`": { `"mod`": `"over9k-todos`" } }"
