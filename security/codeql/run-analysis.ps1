<#
.SYNOPSIS
  Builds the CodeQL database for Portalogia and runs both the project's own
  security queries and GitHub's standard javascript-security-extended suite.

.DESCRIPTION
  Outputs land in security/codeql/results/ (git-ignored):
    portalogia-custom.sarif / .csv          - queries/ in this pack
    standard-security-extended.sarif / .csv - codeql/javascript-queries
  Summarize them into security/reports/security-report-<datetime>.md.

.PARAMETER CodeQL
  Path to codeql.exe. Defaults to `codeql` on PATH, then the copy the VS Code
  CodeQL extension downloads.

.PARAMETER SkipDatabase
  Reuse the existing database instead of re-extracting the source.
#>
param(
  [string]$CodeQL = "",
  [switch]$SkipDatabase
)

# Not 'Stop': codeql prints progress on stderr, which Windows PowerShell 5.1
# would turn into a terminating error. Exit codes are checked instead.
$ErrorActionPreference = 'Continue'

function Invoke-CodeQL {
  & $CodeQL @args
  if ($LASTEXITCODE -ne 0) { throw "codeql $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
}
$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here '..\..')
$db = Join-Path $here 'databases\portalogia-js'
$out = Join-Path $here 'results'

if (-not $CodeQL) {
  $onPath = Get-Command codeql -ErrorAction SilentlyContinue
  $vscode = Join-Path $env:APPDATA 'Code\User\globalStorage\github.vscode-codeql\distribution2\codeql\codeql.exe'
  if ($onPath) { $CodeQL = $onPath.Source }
  elseif (Test-Path $vscode) { $CodeQL = $vscode }
  else { throw 'codeql not found: install the CodeQL CLI or pass -CodeQL <path>.' }
}

New-Item -ItemType Directory -Force (Join-Path $here 'databases'), $out | Out-Null

# Library and query pack dependencies (codeql/javascript-all, javascript-queries).
Invoke-CodeQL pack install $here
Invoke-CodeQL pack download codeql/javascript-queries

if (-not $SkipDatabase) {
  $config = Join-Path $here 'codeql-config.yml'
  Invoke-CodeQL database create $db --language=javascript "--source-root=$repo" `
    "--codescanning-config=$config" --overwrite
}

foreach ($run in @(
    @{ Name = 'portalogia-custom'; Suite = (Join-Path $here 'suites\portalogia-security.qls') },
    @{ Name = 'standard-security-extended'; Suite = 'codeql/javascript-queries:codeql-suites/javascript-security-extended.qls' }
  )) {
  foreach ($format in @('sarif-latest', 'csv')) {
    $ext = if ($format -eq 'csv') { 'csv' } else { 'sarif' }
    $file = Join-Path $out "$($run.Name).$ext"
    Invoke-CodeQL database analyze $db $run.Suite "--format=$format" "--output=$file" --threads=0
  }
}

Write-Host "Results written to $out"
