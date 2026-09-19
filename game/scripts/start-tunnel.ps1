param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'

if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
$origin = "http://127.0.0.1:$Port"
try {
    $null = Invoke-WebRequest -Uri $origin -UseBasicParsing -TimeoutSec 5
} catch {
    throw "Game server is not responding at $origin. Run npm run dev in another terminal first."
}

$installed = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($installed) {
    $tunnelExecutable = $installed.Source
} else {
    $toolsDirectory = Join-Path $PSScriptRoot '..\.tools'
    $tunnelExecutable = Join-Path $toolsDirectory 'cloudflared.exe'
    if (-not (Test-Path -LiteralPath $tunnelExecutable)) {
        $null = New-Item -ItemType Directory -Path $toolsDirectory -Force
        $downloadPath = Join-Path $toolsDirectory 'cloudflared.download'
        Write-Host 'Downloading cloudflared from the official Cloudflare release...'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $downloadPath
        Move-Item -LiteralPath $downloadPath -Destination $tunnelExecutable -Force
    }
}

Write-Host 'Open the HTTPS trycloudflare.com link below on your computer.'
Write-Host 'Then use Copy controller link in the game and open that link on your phone.'
Write-Host 'Keep this terminal open. Press Ctrl+C to stop the public tunnel.'
& $tunnelExecutable tunnel --url $origin
exit $LASTEXITCODE
