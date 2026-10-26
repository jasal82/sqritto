@echo off
rem Baut Sqritto (Markdoc-Engine, HTML5-Site, Oberflaeche und Programm) und legt die
rem Ergebnisse unter dist\ ab:
rem   dist\Sqritto.exe                          App, Server und CLI in einem Programm
rem   dist\packages\Sqritto-X.Y.Z-windows-x64-setup.exe   Installer (Inno Setup 6)
rem
rem   build.cmd                  alles inklusive Installer
rem   build.cmd --no-installer   nur Programm und Lizenzdateien
setlocal
cd /d "%~dp0"
if not "%~1"=="" if not "%~1"=="--no-installer" (
  echo Aufruf: build.cmd [--no-installer]
  exit /b 1
)
node scripts\version.mjs || goto :error

if "%SQRITTO_FRONTEND_READY%"=="1" (
  for %%f in (engine\dist\engine.js site\dist\site.js web\dist\index.html) do (
    if not exist %%f (
      echo SQRITTO_FRONTEND_READY verlangt ein bereits gebautes Frontend ^(%%f fehlt^).
      goto :error
    )
  )
  echo [1-2/3] Vorbereitetes Frontend verwenden ...
) else (
  echo [1/3] Frontend-Abhaengigkeiten ...
  call npm ci --no-audit --no-fund || goto :error
  echo [2/3] Engine, Site und Oberflaeche bauen ...
  call npm run build || goto :error
)

echo [3/3] Programm bauen (Release) ...
cargo build --locked --release --bin sqritto || goto :error

if not exist dist\packages mkdir dist\packages
copy /y target\release\sqritto.exe dist\Sqritto.exe >nul || goto :error
copy /y LICENSE dist\LICENSE.txt >nul || goto :error
copy /y LICENSE-MIT-0 dist\LICENSE-MIT-0.txt >nul || goto :error
node scripts\third-party-licenses.mjs dist\THIRD-PARTY-LICENSES.txt || goto :error
if not "%~1"=="--no-installer" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1 || goto :error
)

echo.
echo Fertig: dist\Sqritto.exe
exit /b 0

:error
echo.
echo Build fehlgeschlagen.
exit /b 1
