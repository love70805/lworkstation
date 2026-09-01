param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$sourceRepo = 'vinvcn/mattpocock-skills-zh-CN'
$sourceRef = '9fb0161ac2be0c45c59cbea0878eb77d92cc24b5'
$skillPaths = [ordered]@{
    'grill-me' = 'skills/productivity/grill-me'
    'grilling' = 'skills/productivity/grilling'
    'grill-with-docs' = 'skills/engineering/grill-with-docs'
    'domain-modeling' = 'skills/engineering/domain-modeling'
    'to-questionnaire' = 'skills/productivity/to-questionnaire'
    'wait-what' = 'skills/productivity/wait-what'
    'to-spec' = 'skills/engineering/to-spec'
    'to-tickets' = 'skills/engineering/to-tickets'
    'wayfinder' = 'skills/engineering/wayfinder'
    'research' = 'skills/engineering/research'
    'diagnosing-bugs' = 'skills/engineering/diagnosing-bugs'
    'code-review' = 'skills/engineering/code-review'
    'resolving-merge-conflicts' = 'skills/engineering/resolving-merge-conflicts'
    'codebase-design' = 'skills/engineering/codebase-design'
    'improve-codebase-architecture' = 'skills/engineering/improve-codebase-architecture'
    'wizard' = 'skills/engineering/wizard'
    'handoff' = 'skills/productivity/handoff'
    'writing-for-agents' = 'skills/productivity/writing-for-agents'
}

$codexHome = if ($env:CODEX_HOME) {
    [System.IO.Path]::GetFullPath($env:CODEX_HOME)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $HOME '.codex'))
}
$destinationRoot = Join-Path $codexHome 'skills'
$projectSkillsRoot = Join-Path $PSScriptRoot 'codex-project-skills'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('shopeers-codex-skills-' + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $tempRoot 'skills.zip'
$extractRoot = Join-Path $tempRoot 'source'

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Child
    )

    $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $resolvedChild = [System.IO.Path]::GetFullPath($Child)
    if (-not $resolvedChild.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside ${resolvedParent}: $resolvedChild"
    }
}

New-Item -ItemType Directory -Path $tempRoot, $extractRoot, $destinationRoot -Force | Out-Null

try {
    $archiveUrl = "https://github.com/$sourceRepo/archive/$sourceRef.zip"
    Write-Host "Downloading workflow skills from $sourceRepo@$sourceRef..."
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot

    $sourceRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $sourceRoot) {
        throw 'The downloaded archive did not contain a repository directory.'
    }

    foreach ($entry in $skillPaths.GetEnumerator()) {
        $name = $entry.Key
        $source = Join-Path $sourceRoot.FullName ($entry.Value -replace '/', '\')
        $destination = Join-Path $destinationRoot $name

        if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) {
            throw "Missing SKILL.md for $name in the downloaded archive."
        }

        if (Test-Path -LiteralPath $destination) {
            if (-not $Force) {
                Write-Host "Already installed: $name"
                continue
            }

            Assert-ChildPath -Parent $destinationRoot -Child $destination
            Remove-Item -LiteralPath $destination -Recurse -Force
        }

        Copy-Item -LiteralPath $source -Destination $destination -Recurse
        Write-Host "Installed: $name"
    }

    if (Test-Path -LiteralPath $projectSkillsRoot) {
        foreach ($projectSkill in Get-ChildItem -LiteralPath $projectSkillsRoot -Directory) {
            $destination = Join-Path $destinationRoot $projectSkill.Name
            if (Test-Path -LiteralPath $destination) {
                Assert-ChildPath -Parent $destinationRoot -Child $destination
                Remove-Item -LiteralPath $destination -Recurse -Force
            }

            Copy-Item -LiteralPath $projectSkill.FullName -Destination $destination -Recurse
            Write-Host "Installed project adapter: $($projectSkill.Name)"
        }
    }
} finally {
    $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    Assert-ChildPath -Parent $systemTemp -Child $tempRoot
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}

Write-Host 'Done. Restart Codex or begin a new turn to load the installed skills.'
