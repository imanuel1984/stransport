$ErrorActionPreference = "Stop"

# Poll /api/errors/latest/ and print new entries.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\watch_errors.ps1
# Optional:
#   $env:ERRORS_API_BASE="http://127.0.0.1:8000"
#   $env:ERRORS_POLL_MS="1500"

$base = $env:ERRORS_API_BASE
if ([string]::IsNullOrWhiteSpace($base)) { $base = "http://127.0.0.1:8000" }
$pollMs = $env:ERRORS_POLL_MS
if ([string]::IsNullOrWhiteSpace($pollMs)) { $pollMs = "1500" }

$url = "$base/api/errors/latest/"
$logPath = Join-Path (Get-Location) "errors_watch.log"

Write-Host "Watching errors at $url (poll ${pollMs}ms)..."
Write-Host "Writing to $logPath"

$seen = @{}

while ($true) {
  try {
    $resp = Invoke-RestMethod -Uri $url -Method Get -Headers @{ Accept = "application/json" } -TimeoutSec 5
    $errors = @()
    if ($resp -and $resp.errors) { $errors = $resp.errors }

    # Print oldest-to-newest so it reads naturally
    [array]::Reverse($errors)

    foreach ($e in $errors) {
      $msg = ""
      $src = ""
      $ts = ""
      $kind = ""
      $path = ""

      if ($e.message) { $msg = [string]$e.message }
      if ($e.source) { $src = [string]$e.source }
      if ($e.timestamp) { $ts = [string]$e.timestamp }
      if ($e.kind) { $kind = [string]$e.kind }
      if ($e.path) { $path = [string]$e.path }

      $key = "$ts|$kind|$src|$path|$msg"
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        $lines = New-Object System.Collections.Generic.List[string]
        $lines.Add("")
        $lines.Add("[$ts] [$kind] $msg")
        if ($src -or $path) {
          $lines.Add("  src=$src  path=$path")
        }
        if ($e.extra) {
          $extraJson = ($e.extra | ConvertTo-Json -Compress)
          $lines.Add("  extra=$extraJson")
        }
        if ($e.stack) {
          $lines.Add("  stack:")
          $lines.Add([string]$e.stack)
        }

        # print
        $lines | ForEach-Object { Write-Host $_ }

        # append to file
        $lines | Out-File -FilePath $logPath -Encoding utf8 -Append
      }
    }
  } catch {
    $errLine = "Fetch failed: $($_.Exception.Message)"
    Write-Host ""
    Write-Host $errLine
    $errLine | Out-File -FilePath $logPath -Encoding utf8 -Append
  }

  Start-Sleep -Milliseconds ([int]$pollMs)
}

