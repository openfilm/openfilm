param([string]$AppFile, [string]$UninstallFile)

$ErrorActionPreference = 'Stop'

function Read-LocalJson([string]$file) {
    try { Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { return $null }
}

try {
    $root = [IO.Path]::GetFullPath($env:OPENFILM_INSTALL_CHECK_PATH)
    $volume = [IO.Path]::GetPathRoot($root)
    $trimmed = $root.TrimEnd([char[]]'\/')
    if ($trimmed -eq $volume.TrimEnd([char[]]'\/')) { exit 20 }
    try { $attributes = [IO.File]::GetAttributes($root) }
    catch [IO.FileNotFoundException], [IO.DirectoryNotFoundException] { exit 0 }
    $directory = [IO.FileAttributes]::Directory
    $reparse = [IO.FileAttributes]::ReparsePoint
    if (-not ($attributes -band $directory) -or ($attributes -band $reparse)) { exit 20 }

    # App files at the top of the Windows package. Preserve anything else, even without a project index.
    $appFiles = @(
        $AppFile, $UninstallFile, 'uninstallerIcon.ico', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
        'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll',
        'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
        'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'
    )
    $appFolders = @('locales', 'resources')
    $resourceFolders = @('app.asar.unpacked', 'runtime')
    $resourceFiles = @('app.asar', 'app-update.yml', 'elevate.exe')
    $resources = Join-Path $root 'resources'
    $markers = @('film.html', '.film', '.openfilm-library.json', '.openfilm-shelf.json')
    $waiting = [Collections.Generic.Stack[string]]::new()
    $waiting.Push($root)
    while ($waiting.Count -gt 0) {
        $parent = $waiting.Pop()
        foreach ($item in [IO.Directory]::EnumerateFileSystemEntries($parent)) {
            $name = [IO.Path]::GetFileName($item)
            $attributes = [IO.File]::GetAttributes($item)
            if (($attributes -band $reparse) -or $markers -contains $name) { exit 10 }
            if ($attributes -band $directory) {
                if ($parent -eq $root -and $appFolders -notcontains $name) { exit 10 }
                if ($parent -eq $resources -and $resourceFolders -notcontains $name) { exit 10 }
                $waiting.Push($item)
            } elseif ($parent -eq $root -and $appFiles -notcontains $name) {
                exit 10
            } elseif ($parent -eq $resources -and $resourceFiles -notcontains $name) {
                exit 10
            }
        }
    }

    # Remembered work locations also protect projects whose film or metadata has gone missing.
    $homes = @($env:OPENFILM_HOME, $env:OPENFILM_SHARED_HOME)
    if ($env:USERPROFILE) {
        $homes += (Join-Path $env:USERPROFILE '.openfilm'), (Join-Path $env:USERPROFILE '.openfilm-preview')
    }
    $prefix = $trimmed + [IO.Path]::DirectorySeparatorChar
    foreach ($homeDir in $homes | Where-Object { $_ } | Select-Object -Unique) {
        $prefsFile = Join-Path $homeDir 'prefs.json'
        $indexFile = Join-Path $homeDir 'studio.json'
        $paths = @()
        $prefs = Read-LocalJson $prefsFile
        $index = Read-LocalJson $indexFile
        if (-not $index) { $index = Read-LocalJson "$indexFile.backup" }
        $paths += $prefs.projectsFolder, $prefs.savedFolder
        $paths += $index.recent | ForEach-Object { $_.path }
        foreach ($path in $paths) {
            if ($path -isnot [string] -or -not [IO.Path]::IsPathRooted($path)) { continue }
            $full = [IO.Path]::GetFullPath($path).TrimEnd([char[]]'\/')
            if (($full -eq $trimmed -or $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -and
                (Test-Path -LiteralPath $path)) { exit 10 }
        }
    }
    exit 0
} catch {
    exit 20
}
