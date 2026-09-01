param()

$ErrorActionPreference = 'Stop'
$script:CurrentStage = 0
$script:TotalStages = 1

function Start-WizardStage {
    param([Parameter(Mandatory = $true)][string]$Title)

    $script:CurrentStage += 1
    Clear-Host
    Write-Host "[$($script:CurrentStage)/$($script:TotalStages)] $Title" -ForegroundColor Cyan
    Write-Host ('-' * 64)
}

function Write-WizardStep {
    param([Parameter(Mandatory = $true)][string]$Message)

    Write-Host $Message
}

function Open-WizardUrl {
    param([Parameter(Mandatory = $true)][string]$Url)

    Start-Process $Url
}

function Read-WizardValue {
    param([Parameter(Mandatory = $true)][string]$Prompt)

    do {
        $value = Read-Host $Prompt
    } while ([string]::IsNullOrWhiteSpace($value))

    return $value.Trim()
}

function Read-WizardSecret {
    param([Parameter(Mandatory = $true)][string]$Prompt)

    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Confirm-WizardAction {
    param([Parameter(Mandatory = $true)][string]$Prompt)

    $answer = Read-Host "$Prompt [y/N]"
    if ($answer -notmatch '^(?i:y|yes)$') {
        throw 'Wizard cancelled by user.'
    }
}

function Set-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $absolutePath = [IO.Path]::GetFullPath($Path)
    $parent = Split-Path -Parent $absolutePath
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $lines = if (Test-Path -LiteralPath $absolutePath) {
        @(Get-Content -LiteralPath $absolutePath)
    } else {
        @()
    }

    $replacement = "$Name=$Value"
    $pattern = '^\s*' + [regex]::Escape($Name) + '='
    $updated = $false
    $lines = @($lines | ForEach-Object {
        if (-not $updated -and $_ -match $pattern) {
            $updated = $true
            $replacement
        } else {
            $_
        }
    })

    if (-not $updated) {
        $lines += $replacement
    }

    Set-Content -LiteralPath $absolutePath -Value $lines -Encoding utf8
}

function Set-GitHubSecret {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw 'GitHub CLI is required to write repository secrets.'
    }

    $Value | gh secret set $Name
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set GitHub secret: $Name"
    }
}

# Replace the example below with the approved human-only stages.
Start-WizardStage -Title 'Example stage'
Write-WizardStep 'Describe the exact manual action here.'
Confirm-WizardAction -Prompt 'Continue after completing this stage?'

Write-Host 'Setup completed.' -ForegroundColor Green
