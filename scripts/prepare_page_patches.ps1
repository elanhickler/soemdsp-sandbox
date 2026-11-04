param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

& python (Join-Path $root "scripts\prepare_page_patches.py")
if ($LASTEXITCODE -ne 0) {
  throw "Page patch publish preflight failed."
}
