param([switch]$Bundle)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& (Join-Path $taskRoot 'toolchain/node/node.exe') (Join-Path $PSScriptRoot 'check-runtime.mjs')
if($LASTEXITCODE -ne 0){throw 'Bundled runtime verification failed'}
