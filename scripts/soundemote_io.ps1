# soundemote.io workflow: one script, three modes. Double-click the .cmd wrappers.
#
#   soundemote_io_preview.cmd          build + copy sandbox into soundemote-io, run it locally (no git)
#   soundemote_io_publish.cmd          everything preview does, then commit + push both repos (goes live)
#   soundemote_io_publish_patches.cmd  patches only: commit sandbox patches, copy them to the site, push (goes live)
#
# Publishing pushes soundemote-io/main, which Lovable deploys.
# Rules it enforces:
#   - sandbox patches are always committed and pushed first (the site only ships committed patches)
#   - publish refuses if soemdsp-sandbox has uncommitted code (live must equal what is committed)
#   - both repos are fast-forwarded from origin before anything is committed
#   - the site patch catalog is written by the site's own generator (npm run catalog)
#
# Options (append to the .cmd):
#   -SkipNativeBuild   reuse the last WASM build (faster)
#   -SkipSmoke         skip the sandbox smoke test (it only reports, never blocks)
#   -NoBrowser         preview: do not open the browser
#   -Port 8080         preview: dev server port
#   -Message "..."     custom soundemote-io commit message
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("preview", "publish", "patches")]
  [string]$Mode,
  [switch]$SkipNativeBuild,
  [switch]$SkipSmoke,
  [switch]$NoBrowser,
  [int]$Port = 8080,
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sandbox = Join-Path $root "soemdsp-sandbox"
$site = Join-Path $root "soundemote-io"
$sitePatchPath = "public/soemdsp-sandbox/patches"
$siteSandboxPath = "public/soemdsp-sandbox"

function Step([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }

function Invoke-Git([string]$repo) {
  & git.exe -C $repo @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed in $repo" }
}

function Get-GitLines([string]$repo) {
  $out = @(& git.exe -C $repo @args)
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed in $repo" }
  return @($out | Where-Object { $_ })
}

function Require-Branch([string]$repo, [string]$branch) {
  $current = (Get-GitLines $repo branch --show-current) -join ""
  if ($current -ne $branch) { throw "$(Split-Path -Leaf $repo) must be on $branch (currently '$current')." }
}

function Sync-FromOrigin([string]$repo, [string]$branch) {
  Invoke-Git $repo fetch -q origin
  $behind = [int]((Get-GitLines $repo rev-list --count "HEAD..origin/$branch") -join "")
  if ($behind -gt 0) {
    Write-Host "  pulling $behind new commit(s) into $(Split-Path -Leaf $repo)"
    Invoke-Git $repo pull -q --ff-only origin $branch
  }
}

function Run([string]$label, [scriptblock]$block) {
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)." }
}

function Sandbox-Version {
  return (Get-Content -LiteralPath (Join-Path $sandbox "VERSION") -Raw).Trim()
}

function Sandbox-Build {
  $server = Get-Content -LiteralPath (Join-Path $sandbox "server.py") -Raw
  if ($server -match 'BUILD_NUMBER\s*=\s*"([^"]+)"') { return $Matches[1] }
  return ""
}

# Today's build number: yyyy.MM.dd.N, N counting up within the same day.
function Bump-Build {
  $serverPath = Join-Path $sandbox "server.py"
  $text = [System.IO.File]::ReadAllText($serverPath, [System.Text.Encoding]::UTF8)
  $old = Sandbox-Build
  $today = (Get-Date).ToString("yyyy.MM.dd")
  $n = 1
  if ($old -match "^$([regex]::Escape($today))\.(\d+)$") { $n = [int]$Matches[1] + 1 }
  $new = "$today.$n"
  $text = [regex]::Replace($text, 'BUILD_NUMBER\s*=\s*"[^"]*"', "BUILD_NUMBER = `"$new`"")
  [System.IO.File]::WriteAllText($serverPath, $text, (New-Object System.Text.UTF8Encoding($false)))
  return $new
}

function Commit-SandboxPatches {
  Step "Committing sandbox patches"
  Run "Patch preflight" { & (Join-Path $sandbox "scripts\prepare_page_patches.ps1") }
  Invoke-Git $sandbox add -A -- patches
  $staged = Get-GitLines $sandbox diff --cached --name-only
  if ($staged.Count -eq 0) {
    Write-Host "  patches already committed"
    return
  }
  $staged | ForEach-Object { Write-Host "  $_" }
  Invoke-Git $sandbox commit -q -m "Update patches"
  Invoke-Git $sandbox push -q origin master
  Write-Host "  committed and pushed $($staged.Count) patch file(s)"
}

function Write-SiteCatalog {
  Push-Location $site
  try { Run "npm run catalog" { npm run -s catalog } } finally { Pop-Location }
}

function Commit-Site([string]$defaultMessage, [string[]]$allowedPrefixes) {
  $changed = Get-GitLines $site status --porcelain
  if ($changed.Count -eq 0) {
    Write-Host "  soundemote-io already current; nothing to publish"
    return $false
  }
  if ($allowedPrefixes) {
    $unexpected = @($changed | Where-Object {
      $path = $_.Substring(3).Trim('"').Replace("\", "/")
      -not ($allowedPrefixes | Where-Object { $path.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) })
    })
    if ($unexpected.Count -gt 0) {
      $unexpected | ForEach-Object { Write-Host "  $_" }
      throw "Changes outside the expected paths in soundemote-io. Refusing to commit unrelated files."
    }
  }
  $msg = if ([string]::IsNullOrWhiteSpace($Message)) { $defaultMessage } else { $Message }
  Invoke-Git $site add -A -- $siteSandboxPath
  Invoke-Git $site commit -q -m $msg
  Invoke-Git $site push -q origin main
  Write-Host "  pushed soundemote-io: $msg" -ForegroundColor Green
  return $true
}

# ---------------------------------------------------------------- checks
foreach ($repo in @($sandbox, $site)) {
  if (!(Test-Path -LiteralPath (Join-Path $repo ".git"))) { throw "Missing repository: $repo" }
}

Write-Host "soundemote.io -- $Mode" -ForegroundColor Cyan
Write-Host "  sandbox: $sandbox"
Write-Host "  site:    $site"

if ($Mode -ne "preview") {
  Step "Checking repositories"
  Require-Branch $sandbox "master"
  Require-Branch $site "main"
  # Leftovers from a preview under public/soemdsp-sandbox are regenerated below,
  # so drop them. Anything else uncommitted in the site is real work: stop.
  $siteDirty = Get-GitLines $site status --porcelain
  $siteOther = @($siteDirty | Where-Object { -not $_.Substring(3).Trim('"').StartsWith("$siteSandboxPath/") })
  if ($siteOther.Count -gt 0) {
    $siteOther | ForEach-Object { Write-Host "  $_" }
    throw "soundemote-io has uncommitted changes outside $siteSandboxPath. Commit or discard them first."
  }
  if ($siteDirty.Count -gt 0) {
    Write-Host "  discarding preview leftovers in soundemote-io/$siteSandboxPath"
    Invoke-Git $site checkout -q -- $siteSandboxPath
    Invoke-Git $site clean -q -fd -- $siteSandboxPath
  }
  if ($Mode -eq "publish") {
    $dirtyCode = @(Get-GitLines $sandbox status --porcelain | Where-Object { $_.Substring(3).Trim('"') -notlike "patches/*" })
    if ($dirtyCode.Count -gt 0) {
      $dirtyCode | ForEach-Object { Write-Host "  $_" }
      throw "soemdsp-sandbox has uncommitted code. Commit it first so the live site matches git."
    }
  }
  Sync-FromOrigin $sandbox "master"
  Sync-FromOrigin $site "main"
  Commit-SandboxPatches
}

# ---------------------------------------------------------------- patches only
if ($Mode -eq "patches") {
  Step "Copying patches into soundemote-io"
  $src = Join-Path $sandbox "patches"
  $dst = Join-Path $site $sitePatchPath
  if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  $tracked = Get-GitLines $sandbox ls-files -- patches
  foreach ($rel in $tracked) {
    if ($rel -ieq "patches/index.json") { continue }  # site writes its own catalog
    $from = Join-Path $sandbox $rel
    $to = Join-Path $dst $rel.Substring("patches/".Length)
    New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
  }
  Write-SiteCatalog
  Step "Publishing"
  $null = Commit-Site "Sync sandbox patches (build $(Sandbox-Build))" @("$sitePatchPath/")
  Write-Host ""
  Write-Host "Done." -ForegroundColor Green
  return
}

# ---------------------------------------------------------------- full build (preview + publish)
if ($Mode -eq "publish") {
  $build = Bump-Build
  Write-Host ""
  Write-Host "  build number -> $build"
} else {
  $build = Sandbox-Build
}

if (!$SkipNativeBuild) {
  Step "Building native modules (WASM)"
  Run "Native module build" { & (Join-Path $sandbox "scripts\build_native_modules.ps1") }
} else {
  Step "Skipping native module build"
}

Step "Regenerating native module catalog"
Run "Native module catalog" { python (Join-Path $sandbox "scripts\generate_native_modules_catalog.py") }

if (!$SkipSmoke) {
  Step "Smoke test (reports only, never blocks)"
  Push-Location $sandbox
  try { node (Join-Path $sandbox "scripts\smoke.mjs") } finally { Pop-Location }
} else {
  Step "Skipping smoke test"
}

if ($Mode -eq "publish") {
  Step "Committing sandbox build $build"
  # Tracked build outputs only (-u): server.py build number, rebuilt .wasm, catalogs.
  Invoke-Git $sandbox add -u -- server.py public/native-modules-catalog.json native_modules patches
  Invoke-Git $sandbox commit -q -m "Build $build"
  Invoke-Git $sandbox push -q origin master
  Write-Host "  pushed soemdsp-sandbox: Build $build"
}

Step "Copying sandbox into soundemote-io"
Run "Sandbox-to-site sync" { & (Join-Path $sandbox "scripts\sync_soundemote_io.ps1") -SiteRoot $site }
Write-SiteCatalog

if ($Mode -eq "publish") {
  Step "Publishing"
  $null = Commit-Site "$(Sandbox-Version) (build $build)" @("$siteSandboxPath/")
  Write-Host ""
  Write-Host "Done. Lovable deploys soundemote-io/main." -ForegroundColor Green
  return
}

# ---------------------------------------------------------------- preview
Step "Starting soundemote-io on http://localhost:$Port/"
$listeners = @(netstat -ano 2>$null | Select-String ":$Port\s+.*LISTENING")
foreach ($line in $listeners) {
  $processId = 0
  [void][int]::TryParse((($line.ToString() -split "\s+") | Where-Object { $_ })[-1], [ref]$processId)
  if ($processId -gt 0) {
    Write-Host "  stopping old server on port $Port (PID $processId)"
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}
if (!$NoBrowser) { Start-Process "http://localhost:$Port/" }
Push-Location $site
try { npm run dev -- --host 0.0.0.0 --port $Port } finally { Pop-Location }
