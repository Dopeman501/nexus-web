$ErrorActionPreference = 'Stop'
$dashboardDirectory = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $dashboardDirectory
try {
    & node node_modules/vite/bin/vite.js build --config transition-lab/vite.config.ts
    if ($LASTEXITCODE -ne 0) { throw 'Transition lab build failed.' }
    & node node_modules/vite/bin/vite.js preview --config transition-lab/vite.config.ts
    if ($LASTEXITCODE -ne 0) { throw 'Transition lab preview could not start.' }
}
finally { Pop-Location }
