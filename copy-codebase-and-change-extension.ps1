[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string[]]$Map,

    [Parameter(Mandatory = $false)]
    [string[]]$SourceExts,

    [Parameter(Mandatory = $false)]
    [string]$DestExt,

    [Parameter(Mandatory = $false)]
    [string]$InsertToken,

    [Parameter(Mandatory = $false)]
    [string[]]$Ignore,

    [Parameter(Mandatory = $false)]
    [string]$DestFolderName = "codebase-txt",

    [Parameter(Mandatory = $false)]
    [string]$Root = $PSScriptRoot,

    [switch]$NonInteractive,

    [switch]$NoPath,

    [switch]$MergeToSingleFile,

    [Parameter(Mandatory = $false)]
    [string]$MergedFileName = "merged_codebase.txt"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "Continue"

function Normalize-Ext {
    param([string]$Ext)
    if ([string]::IsNullOrWhiteSpace($Ext)) { return $null }
    if ($Ext.StartsWith(".")) { return $Ext }
    return ".$Ext"
}

function Normalize-NameSegment {
    param([string]$Seg)
    if ([string]::IsNullOrWhiteSpace($Seg)) { return $null }
    return $Seg.Trim().TrimStart(".")
}

function Test-ShouldIgnore {
    param(
        [string]$FullPath,
        [string]$FileName
    )

    $relativePath = $FullPath.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')

    foreach ($pattern in $IgnorePatterns) {
        if ([string]::IsNullOrWhiteSpace($pattern)) { continue }

        $pattern = $pattern.Replace('\', '/')

        if ($pattern.EndsWith('/')) {
            $pattern = $pattern.TrimEnd('/') + '/*'
        }

        if ($relativePath -like $pattern) { return $true }

        if ($FileName -like $pattern) { return $true }

        if ($pattern -notlike "*/*") {
            $pathParts = $relativePath -split '/'
            foreach ($part in $pathParts[0..($pathParts.Count-2)]) {
                if ($part -like $pattern) { return $true }
            }
        }
    }
    return $false
}

function Get-SafeFileName {
    param(
        [string]$DestPath,
        [string]$BaseName,
        [string]$Extension
    )

    $FullPath = Join-Path $DestPath "$BaseName$Extension"
    if (-not (Test-Path $FullPath)) {
        return $FullPath
    }

    for ($i = 1; $i -lt 1000; $i++) {
        $FullPath = Join-Path $DestPath "$BaseName($i)$Extension"
        if (-not (Test-Path $FullPath)) {
            return $FullPath
        }
    }

    throw "Unable to find unique filename for $BaseName"
}

function Process-Mapping {
    param(
        [string]$SourceExt,
        [string]$DestExt,
        [string]$InsertToken
    )

    $SourceExt = Normalize-Ext $SourceExt
    $DestExt   = Normalize-Ext $DestExt
    $InsertSeg = Normalize-NameSegment $InsertToken

    if (-not $SourceExt -or -not $DestExt) {
        Write-Host "Invalid mapping: SourceExt='$SourceExt' DestExt='$DestExt'." -ForegroundColor Red
        return
    }

    Write-Host ""
    Write-Host "Searching for $SourceExt files..." -ForegroundColor Yellow

    $Files = Get-ChildItem -Path $Root -Filter "*$SourceExt" -Recurse -File |
            Where-Object {
                -not (Test-ShouldIgnore -FullPath $_.FullName -FileName $_.Name) -and
                        ($_.FullName -notlike (Join-Path $DestDir "*"))
            }

    $FileCount = @($Files).Count
    if ($FileCount -eq 0) {
        Write-Host "No $SourceExt files found (after applying ignore patterns)." -ForegroundColor Red
        return
    }

    Write-Host "Found $FileCount file(s) to copy..." -ForegroundColor Green

    $i = 0
    $SessionCount = 0
    foreach ($File in $Files) {
        $i++
        $PercentComplete = [int](($i / $FileCount) * 100)
        Write-Progress -Activity "Copying files ($SourceExt -> $DestExt)" `
            -Status "Processing: $($File.Name)" `
            -PercentComplete $PercentComplete `
            -CurrentOperation "$i of $FileCount files"

        try {
            $srcExtNoDot = $File.Extension.TrimStart(".")
            $segments = @()
            if ($srcExtNoDot) { $segments += $srcExtNoDot }
            if ($InsertSeg)   { $segments += $InsertSeg }

            $AugBase = if ($segments.Count -gt 0) {
                "$($File.BaseName)." + ($segments -join ".")
            } else {
                $File.BaseName
            }

            $relativePath = $File.FullName.Substring($Root.Length).TrimStart('\', '/')
            $fileContent = Get-Content -Path $File.FullName -Raw

            if ($MergeToSingleFile) {
                $script:MergedContent += "`n`n"
                if (-not $NoPath) {
                    $script:MergedContent += "=" * 80 + "`n"
                    $script:MergedContent += "FILE PATH: $relativePath`n"
                    $script:MergedContent += "=" * 80 + "`n"
                }
                $script:MergedContent += $fileContent
            } else {
                $SafePath = Get-SafeFileName -DestPath $DestDir -BaseName $AugBase -Extension $DestExt

                if (-not $NoPath) {
                    $finalContent = "=" * 80 + "`n"
                    $finalContent += "FILE PATH: $relativePath`n"
                    $finalContent += "=" * 80 + "`n"
                    $finalContent += $fileContent
                    Set-Content -Path $SafePath -Value $finalContent -Force
                } else {
                    Copy-Item -Path $File.FullName -Destination $SafePath -Force
                }
            }

            $SessionCount++
            $script:TotalFileCount++
        }
        catch {
            Write-Host "Error copying $($File.Name): $_" -ForegroundColor Red
        }
    }

    Write-Progress -Activity "Copying files ($SourceExt -> $DestExt)" -Completed
    Write-Host "Copied $SessionCount file(s) from $SourceExt to $DestExt" -ForegroundColor Green
}

$DestDir = Join-Path $Root $DestFolderName
$CodeIgnoreFile = Join-Path $Root ".codeignore"
$TotalFileCount = 0
$MergedContent = ""

$UsingArgs = ($Map -and $Map.Count -gt 0) -or ($SourceExts -and $DestExt)

if (-not $UsingArgs -and -not $NonInteractive) { Clear-Host }
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  Fast Recursive File Copier - PowerShell Edition" -ForegroundColor White
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

$IgnorePatterns = @()

if (Test-Path $CodeIgnoreFile) {
    Write-Host "Loading .codeignore file from $CodeIgnoreFile..." -ForegroundColor Yellow
    $codeIgnorePatterns = Get-Content $CodeIgnoreFile | ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and ($_ -notmatch '^\s*#') }
    $IgnorePatterns += $codeIgnorePatterns
    foreach ($pattern in $codeIgnorePatterns) {
        Write-Host "  Ignoring pattern: $pattern" -ForegroundColor DarkGray
    }
    Write-Host ""
}

$IgnorePatterns += $DestFolderName
$IgnorePatterns += "$DestFolderName/*"

if ($Ignore -and $Ignore.Count -gt 0) {
    Write-Host "Loading ignore patterns from parameters..." -ForegroundColor Yellow
    $paramIgnorePatterns = $Ignore | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    $IgnorePatterns += $paramIgnorePatterns
    foreach ($pattern in $paramIgnorePatterns) {
        Write-Host "  Ignoring pattern: $pattern" -ForegroundColor DarkGray
    }
    Write-Host ""
}

if (Test-Path $DestDir) {
    Write-Host "Removing old '$DestFolderName' folder..." -ForegroundColor Yellow
    Remove-Item -Path $DestDir -Recurse -Force
}

New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
Write-Host "Created destination folder: $DestFolderName" -ForegroundColor Green
Write-Host ""

$Mappings = New-Object System.Collections.Generic.List[object]

if ($Map -and $Map.Count -gt 0) {
    foreach ($m in $Map) {
        if ($m -match '^\s*\.?([^:=\s]+)\s*[:=]\s*\.?([^;\s]+)\s*$') {
            $Mappings.Add([pscustomobject]@{
                SourceExt = $Matches[1]
                DestExt   = $Matches[2]
            })
        }
        else {
            throw "Invalid map entry '$m'. Use format like 'py=md' or 'js:txt'."
        }
    }
}
elseif ($SourceExts -and $DestExt) {
    foreach ($s in $SourceExts) {
        if (-not [string]::IsNullOrWhiteSpace($s)) {
            $Mappings.Add([pscustomobject]@{
                SourceExt = $s
                DestExt   = $DestExt
            })
        }
    }
}

if ($Mappings.Count -gt 0) {
    foreach ($mapEntry in $Mappings) {
        Process-Mapping -SourceExt $mapEntry.SourceExt -DestExt $mapEntry.DestExt -InsertToken $InsertToken
    }
}
else {
    while ($true) {
        Write-Host "=================================================" -ForegroundColor Cyan
        Write-Host " Total files copied: $TotalFileCount" -ForegroundColor White
        Write-Host "=================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Enter extensions to convert (or press Enter to exit)" -ForegroundColor White
        Write-Host ""

        $SourceExt = Read-Host "SOURCE extension (e.g., py, js, cpp)"
        if ([string]::IsNullOrWhiteSpace($SourceExt)) {
            break
        }

        $DestExt = Read-Host "DESTINATION extension (e.g., md, txt)"
        if ([string]::IsNullOrWhiteSpace($DestExt)) {
            continue
        }

        $InsertT = Read-Host "MIDDLE token to insert after original extension (e.g., txt). Leave blank to omit"

        $IgnoreInput = Read-Host "Files/paths to ignore (wildcards OK, comma-separated). Leave blank to skip"
        if (-not [string]::IsNullOrWhiteSpace($IgnoreInput)) {
            $NewPatterns = $IgnoreInput -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
            $IgnorePatterns += $NewPatterns
            Write-Host "  Added ignore patterns: $($NewPatterns -join ', ')" -ForegroundColor DarkGray
        }

        Process-Mapping -SourceExt $SourceExt -DestExt $DestExt -InsertToken $InsertT

        Write-Host ""
        Write-Host "Copied files so far: $TotalFileCount" -ForegroundColor Green
        Write-Host ""
    }
}

if ($MergeToSingleFile -and $MergedContent) {
    $MergedFilePath = Join-Path $DestDir $MergedFileName
    Set-Content -Path $MergedFilePath -Value $MergedContent.TrimStart() -Force
    Write-Host ""
    Write-Host "All files merged into: $MergedFileName" -ForegroundColor Green
}

if (-not $UsingArgs -and -not $NonInteractive) {
    Clear-Host
    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "  Operation Complete" -ForegroundColor White
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Total files copied: $TotalFileCount" -ForegroundColor Green
    Write-Host "Destination folder: $DestFolderName" -ForegroundColor White
    if ($MergeToSingleFile -and $MergedContent) {
        Write-Host "Merged file: $MergedFileName" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
} else {
    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "  Operation Complete" -ForegroundColor White
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Total files copied: $TotalFileCount" -ForegroundColor Green
    Write-Host "Destination folder: $DestFolderName" -ForegroundColor White
    if ($MergeToSingleFile -and $MergedContent) {
        Write-Host "Merged file: $MergedFileName" -ForegroundColor White
    }
}