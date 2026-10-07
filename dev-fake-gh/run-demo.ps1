# Starts Claude Code with the plugin loaded and the fake gh first on PATH (this process only).
# Use -Launcher jev-claude to start it through jev-claude instead of plain claude.
param([string]$Launcher = 'claude')

$here = $PSScriptRoot
$plugin = Split-Path $here -Parent
$env:PATH = "$here;$env:PATH"
Write-Host "Using fake gh: $((Get-Command gh).Source)"
& $Launcher --plugin-dir $plugin
