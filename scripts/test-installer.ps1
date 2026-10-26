# Prüft den erzeugten Windows-Installer wie ein Anwender: stille Installation,
# Rauchtest des installierten Programms (CLI-Build und Server), Update über eine
# bestehende Installation und Deinstallation.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = & node "$root/scripts/version.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Versionsprüfung fehlgeschlagen.' }
$installer = Join-Path $root "dist/packages/Sqritto-$version-windows-x64-setup.exe"
if (!(Test-Path -LiteralPath $installer)) { throw "$installer fehlt. Zuerst build.cmd ausführen." }
$installDir = Join-Path ([IO.Path]::GetTempPath()) ("sqritto-installer-test-" + [guid]::NewGuid())
$arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', "/DIR=`"$installDir`"")
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{532A3587-2FB0-436A-B81B-F1EB5FE2A53F}_is1'

function Install([string]$label) {
    $setup = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
    if ($setup.ExitCode -ne 0) { throw "$label fehlgeschlagen (Exitcode $($setup.ExitCode))." }
    foreach ($name in 'Sqritto.exe', 'LICENSE.txt', 'LICENSE-MIT-0.txt', 'THIRD-PARTY-LICENSES.txt', 'unins000.exe') {
        if (!(Test-Path -LiteralPath "$installDir/$name")) { throw "$label`: $name fehlt im Programmordner." }
    }
    $entry = Get-ItemProperty -LiteralPath $uninstallKey
    if ($entry.DisplayVersion -ne $version) { throw "$label`: Version $($entry.DisplayVersion) statt $version eingetragen." }
    Write-Host "  ok  $label"
}

Install 'Installation'
$exeVersion = (Get-Item -LiteralPath "$installDir/Sqritto.exe").VersionInfo.ProductVersion
if (!$exeVersion.StartsWith($version)) { throw "Sqritto.exe meldet Version $exeVersion statt $version." }
Write-Host "  ok  Sqritto.exe trägt Version $exeVersion"

& node "$root/scripts/smoke-test.mjs" "$installDir/Sqritto.exe"
if ($LASTEXITCODE -ne 0) { throw 'Rauchtest des installierten Programms fehlgeschlagen.' }

Install 'Update über bestehende Installation'

$uninstall = Start-Process -FilePath "$installDir/unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "Deinstallation fehlgeschlagen (Exitcode $($uninstall.ExitCode))." }
# Das Deinstallationsprogramm entfernt sich verzögert selbst.
for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath "$installDir/Sqritto.exe"); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath "$installDir/Sqritto.exe") { throw 'Die Deinstallation hat Sqritto.exe nicht entfernt.' }
if (Test-Path -LiteralPath $uninstallKey) { throw 'Die Deinstallation hat den Eintrag in „Apps“ nicht entfernt.' }
Write-Host '  ok  Deinstallation'
Write-Host 'Installer-Test bestanden.'
