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

# Wartet mit Zeitlimit nur auf den Prozess selbst (Start-Process -Wait wartet ohne Limit auch
# auf alle Nachfahren) und liefert seinen Exitcode.
function Wait-Exit([Diagnostics.Process]$process, [string]$label, [int]$seconds = 300) {
    $null = $process.Handle # hält den Exitcode nach WaitForExit lesbar
    if (!$process.WaitForExit($seconds * 1000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$label ist nach $seconds s nicht fertig geworden."
    }
    $process.ExitCode
}

function Install([string]$label) {
    $setup = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $exitCode = Wait-Exit $setup $label
    if ($exitCode -ne 0) { throw "$label fehlgeschlagen (Exitcode $exitCode)." }
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

# Selbst-Update (src/update.rs): Das von Sqritto gestartete Setup startet das Programm wieder, das
# Port und Zugangstoken der vorigen Version aus der Umgebung übernimmt. SQRITTO_NO_OPEN hält den
# Test unsichtbar. Nicht mit -Wait: Das wartet auch auf alle Nachfahren, also auf das neu
# gestartete Programm.
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$token = [guid]::NewGuid().ToString('N')
$relaunchWork = Join-Path ([IO.Path]::GetTempPath()) ("sqritto-relaunch-test-" + [guid]::NewGuid())
$relaunchEnv = @{
    SQRITTO_RESTART_PORT = "$port"
    SQRITTO_RESTART_TOKEN = $token
    SQRITTO_NO_OPEN = '1'
    SQRITTO_CONFIG_DIR = Join-Path $relaunchWork 'config'
    SQRITTO_WORKSPACE = Join-Path $relaunchWork 'workspace'
}
$savedEnv = @{}
foreach ($name in $relaunchEnv.Keys) {
    $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, $relaunchEnv[$name])
}
try {
    $setup = Start-Process -FilePath $installer -ArgumentList ($arguments + '/RELAUNCH=1') -WindowStyle Hidden -PassThru
    $exitCode = Wait-Exit $setup 'Update mit Neustart'
    if ($exitCode -ne 0) { throw "Update mit Neustart fehlgeschlagen (Exitcode $exitCode)." }
    $info = $null
    for ($i = 0; $i -lt 60 -and !$info; $i++) {
        try {
            $info = Invoke-RestMethod "http://127.0.0.1:$port/api/info" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 2
        } catch { Start-Sleep -Seconds 1 }
    }
    # Über den Port gefunden: Der Programmpfad kann in der kurzen 8.3-Form angegeben sein.
    $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -First 1
    if ($owner) {
        Stop-Process -Id $owner
        Wait-Process -Id $owner -ErrorAction SilentlyContinue
    }
    if (!$info) { throw 'Das Setup hat Sqritto nach /RELAUNCH nicht wieder gestartet (oder Port/Token nicht übernommen).' }
    if ($info.version -ne $version) { throw "Nach dem Neustart läuft Version $($info.version) statt $version." }
    Write-Host '  ok  Neustart nach dem Update (/RELAUNCH, Port und Token übernommen)'
} finally {
    foreach ($name in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name]) }
}

$uninstall = Start-Process -FilePath "$installDir/unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -PassThru
$exitCode = Wait-Exit $uninstall 'Deinstallation'
if ($exitCode -ne 0) { throw "Deinstallation fehlgeschlagen (Exitcode $exitCode)." }
# Das Deinstallationsprogramm entfernt sich verzögert selbst.
for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath "$installDir/Sqritto.exe"); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath "$installDir/Sqritto.exe") { throw 'Die Deinstallation hat Sqritto.exe nicht entfernt.' }
if (Test-Path -LiteralPath $uninstallKey) { throw 'Die Deinstallation hat den Eintrag in „Apps“ nicht entfernt.' }
Write-Host '  ok  Deinstallation'
Write-Host 'Installer-Test bestanden.'
