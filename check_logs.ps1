$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adbPath)) {
	$adbPath = "adb"
}

$devices = & $adbPath devices
$connected = @($devices | Select-String -Pattern "\tdevice$")
if ($connected.Count -eq 0) {
	Write-Host "No connected Android device found. Connect device and enable USB debugging, then run again."
	exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $repoRoot ("crash_logcat_" + $timestamp + ".txt")

# Clear old logs, then capture fresh crash-relevant logs only.
& $adbPath logcat -c | Out-Null
Write-Host "Log buffer cleared. Reproduce the crash now, then press Enter to capture logs..."
Read-Host | Out-Null

& $adbPath logcat -d -v time | Select-String -Pattern "FATAL EXCEPTION|AndroidRuntime|ANR in|SIGSEGV|ReactNativeJS|com.IRopit|Process: com.IRopit|Caused by:" | Out-File -FilePath $outFile -Encoding UTF8

Write-Host "Done. Crash log saved to: $outFile"
