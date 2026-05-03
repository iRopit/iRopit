$extDir = $PSScriptRoot
$version = (Get-Content (Join-Path $extDir "manifest.json") | ConvertFrom-Json).version
$zipPath = Join-Path $extDir "IRopit-Extension-v$version.zip"

# Remove old zip
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Create temp staging folder  
$tempDir = Join-Path $env:TEMP "iropit-ext-build"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tempDir "assets") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tempDir "popup") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tempDir "background") | Out-Null

# Copy files
Copy-Item (Join-Path $extDir "manifest.json") $tempDir
Copy-Item (Join-Path $extDir "firebase-config.js") $tempDir
Copy-Item (Join-Path $extDir "assets\icon16.png") (Join-Path $tempDir "assets")
Copy-Item (Join-Path $extDir "assets\icon32.png") (Join-Path $tempDir "assets")
Copy-Item (Join-Path $extDir "assets\icon48.png") (Join-Path $tempDir "assets")
Copy-Item (Join-Path $extDir "assets\icon128.png") (Join-Path $tempDir "assets")
Copy-Item (Join-Path $extDir "popup\popup.html") (Join-Path $tempDir "popup")
Copy-Item (Join-Path $extDir "popup\popup.css") (Join-Path $tempDir "popup")
Copy-Item (Join-Path $extDir "popup\popup.bundle.js") (Join-Path $tempDir "popup")
Copy-Item (Join-Path $extDir "background\service-worker.js") (Join-Path $tempDir "background")

# Create ZIP
Compress-Archive -Path (Join-Path $tempDir "*") -DestinationPath $zipPath -Force

# Cleanup
Remove-Item $tempDir -Recurse -Force

# Verify
if (Test-Path $zipPath) {
    $size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
    Write-Host "Extension ZIP created: $zipPath ($size KB)"
} else {
    Write-Host "ERROR: ZIP creation failed!"
}
