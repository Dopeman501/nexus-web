param([Parameter(Mandatory = $true)][string]$ProcessIds)
$ErrorActionPreference = 'Stop'
$sampleIds = @($ProcessIds.Split(',') | ForEach-Object {
    $sampleId = 0
    if (-not [int]::TryParse($_, [ref]$sampleId) -or $sampleId -le 0) { throw 'Invalid owned browser process id.' }
    $sampleId
})
if ($sampleIds.Count -gt 64) { throw 'Unexpected owned browser process count.' }
$samples = @(foreach ($sampleId in $sampleIds) {
    try {
        $sampleProcess = Get-Process -Id $sampleId -ErrorAction Stop
        [pscustomobject]@{ Id = $sampleProcess.Id; Name = $sampleProcess.ProcessName
            PrivateBytes = $sampleProcess.PrivateMemorySize64; WorkingSetBytes = $sampleProcess.WorkingSet64
            Handles = $sampleProcess.HandleCount; Threads = $sampleProcess.Threads.Count }
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] { }
})
ConvertTo-Json -InputObject $samples -Compress
