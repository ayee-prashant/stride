<#
Does the agent receive exactly the bytes we intended?

Two bugs got through before this existed, both silent corruption of an agent's
own instructions: PowerShell 5.1 split a native-command argument on embedded
double quotes and newlines, and Set-Content -Encoding utf8 prepended a BOM.
Neither showed up as a failure - the agent simply worked from a corrupted brief.

So this asserts on the SHA-256 of the bytes at each boundary, not on how the
text looks:

  host string -> PowerShell writer -> file -> bind mount -> Linux container
              -> sha256sum inside the container

Run: powershell -File encoding.test.ps1
#>
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cfg = Get-Content (Join-Path (Split-Path -Parent $Here) 'agents.json') -Raw | ConvertFrom-Json
$Image = $Cfg.runtimes.claude.image

$pass = 0; $fail = 0
function Check([string]$name, [bool]$cond, [string]$detail = '') {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" }
  else { $script:fail++; Write-Host "  FAIL  $name $detail" -ForegroundColor Red }
}

# The cases. Each is a payload we must be able to hand an agent unchanged.
$cases = [ordered]@{
  'ascii'               = 'plain ascii text'
  'double quotes'       = 'he said "1.5 KB" and left'
  'single quotes'       = "it's agent1's turn"
  'backtick and dollar' = 'cost $5 `escaped` ${var}'
  'newlines'            = "line one`nline two`nline three"
  'crlf'                = "line one`r`nline two"
  'no final newline'    = 'ends abruptly'
  'trailing newlines'   = "body`n`n`n"
  'tabs'                = "col1`tcol2`tcol3"
  'latin accents'       = 'resume vs resume: e-acute and u-umlaut'
  'rupee sign'          = 'costs 500 rupees'
  'chinese'             = 'this line carries CJK'
  'japanese'            = 'and this one kana'
  'arabic rtl'          = 'and this one right-to-left'
  'emoji'               = 'ship it rocket'
  'long line'           = ('x' * 8000)
  'json payload'        = '{"a":1,"b":"two","c":[3,{"d":"\"quoted\""}]}'
  'shell metachars'     = 'rm -rf / ; echo $(whoami) && ls | grep x'
  'empty'               = ''
}
# Add the genuinely non-ASCII payloads as code points, so this file stays ASCII
# and cannot itself be corrupted by a checkout or an editor.
$cases['latin accents'] = "r$([char]0xE9)sum$([char]0xE9) vs na$([char]0xEF)ve"
$cases['rupee sign']    = "costs $([char]0x20B9)500"
$cases['chinese']       = "$([char]0x4F60)$([char]0x597D)$([char]0x4E16)$([char]0x754C)"
$cases['japanese']      = "$([char]0x3053)$([char]0x3093)$([char]0x306B)$([char]0x3061)$([char]0x306F)"
$cases['arabic rtl']    = "$([char]0x0645)$([char]0x0631)$([char]0x062D)$([char]0x0628)$([char]0x0627)"
$cases['emoji']         = "ship it $([char]::ConvertFromUtf32(0x1F680))"

$tmp = Join-Path $env:TEMP "agents-encoding-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

Write-Host ""
Write-Host "  byte preservation: host -> file -> container" -ForegroundColor White

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
foreach ($name in $cases.Keys) {
  $payload = $cases[$name]
  $file = Join-Path $tmp 'prompt.txt'

  # Exactly what runner.ps1 does.
  [System.IO.File]::WriteAllText($file, $payload, $utf8NoBom)

  # What we intended, as bytes.
  $expectBytes = $utf8NoBom.GetBytes($payload)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $expect = ([BitConverter]::ToString($sha.ComputeHash($expectBytes))).Replace('-', '').ToLower()

  # What the container actually reads off the mount.
  $actual = (& docker run --rm -v "${file}:/prompt.txt:ro" $Image sha256sum /prompt.txt 2>&1 |
    Select-Object -First 1) -split '\s+' | Select-Object -First 1

  Check ("{0,-20} {1} bytes" -f $name, $expectBytes.Length) ($actual -eq $expect) "expected $($expect.Substring(0,12)) got $($actual)"
}

Write-Host ""
Write-Host "  no byte-order mark is ever written" -ForegroundColor White
$file = Join-Path $tmp 'bom.txt'
[System.IO.File]::WriteAllText($file, 'Read this', $utf8NoBom)
$first3 = [System.IO.File]::ReadAllBytes($file)[0..2] -join ','
Check "first bytes are content, not EF,BB,BF" ($first3 -eq '82,101,97') "got $first3"

# The trap this replaces: the old call site used Set-Content -Encoding utf8.
$legacy = Join-Path $tmp 'legacy.txt'
Set-Content -Path $legacy -Value 'Read this' -Encoding utf8 -NoNewline
$lb = [System.IO.File]::ReadAllBytes($legacy)
$hasBom = ($lb.Length -ge 3 -and $lb[0] -eq 0xEF -and $lb[1] -eq 0xBB -and $lb[2] -eq 0xBF)
Check "Set-Content -Encoding utf8 still adds one (why we do not use it)" $hasBom "no BOM - PowerShell behaviour changed, revisit runner.ps1"

Write-Host ""
Write-Host "  a NUL byte must be rejected, not silently truncated" -ForegroundColor White
$nulFile = Join-Path $tmp 'nul.txt'
[System.IO.File]::WriteAllBytes($nulFile, [byte[]](0x61, 0x00, 0x62))
$len = (& docker run --rm -v "${nulFile}:/p:ro" $Image bash -lc 'wc -c < /p' 2>&1 | Select-Object -First 1).Trim()
Check "all 3 bytes survive the mount, NUL included" ($len -eq '3') "got $len"

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  $pass passed, $fail failed"
if ($fail -eq 0) { Write-Host "  RESULT: PASS" -ForegroundColor Green } else { Write-Host "  RESULT: FAIL" -ForegroundColor Red }
Write-Host ""
exit $(if ($fail -eq 0) { 0 } else { 1 })
