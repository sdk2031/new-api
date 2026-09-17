[CmdletBinding()]
param(
    [string]$CustomizationBranch = 'codex/model-monitoring'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $repositoryRoot
try {
    $changes = git status --porcelain
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to read Git worktree status.'
    }
    if ($changes) {
        throw 'The worktree is not clean. Commit or stash local changes before updating.'
    }

    $branch = git branch --show-current
    if ($LASTEXITCODE -ne 0 -or -not $branch) {
        throw 'Updates must run from a named customization branch.'
    }
    if ($branch -ne $CustomizationBranch) {
        throw "Switch to the customization branch first: git switch $CustomizationBranch"
    }

    Write-Host "Updating $branch from upstream/main..."
    git fetch upstream main
    if ($LASTEXITCODE -ne 0) {
        throw 'git fetch failed.'
    }

    git merge --no-edit upstream/main
    if ($LASTEXITCODE -ne 0) {
        throw 'git merge failed. Resolve the reported conflicts, then commit the merge.'
    }

    Write-Host 'Customization branch updated. Push it to trigger GitHub Actions.'
}
finally {
    Pop-Location
}
