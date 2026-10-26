; Windows-Installer für Sqritto (Inno Setup 6).
; Erzeugen über scripts/build-installer.ps1 bzw. build.cmd nach dem Release-Build.
#ifndef AppVersion
  #error AppVersion muss vom Build-Skript übergeben werden
#endif

[Setup]
; Die AppId nie ändern: an ihr erkennt Windows Updates und Deinstallation.
AppId={{532A3587-2FB0-436A-B81B-F1EB5FE2A53F}
AppName=Sqritto
AppVersion={#AppVersion}
AppVerName=Sqritto {#AppVersion}
AppPublisher=Johannes Asal
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Sqritto
VersionInfoDescription=Sqritto Setup
DefaultDirName={localappdata}\Programs\Sqritto
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile=..\LICENSE
SetupIconFile=..\assets\icon\sqritto.ico
UninstallDisplayIcon={app}\Sqritto.exe
UninstallDisplayName=Sqritto
OutputDir=..\dist\packages
OutputBaseFilename=Sqritto-{#AppVersion}-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Ausdrückliche Liste: Dokumente liegen im Arbeitsbereich (Dokumente\Sqritto), nie im Programmordner.
Source: "..\dist\Sqritto.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\LICENSE-MIT-0.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\THIRD-PARTY-LICENSES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Sqritto"; Filename: "{app}\Sqritto.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Sqritto"; Filename: "{app}\Sqritto.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Sqritto.exe"; Description: "{cm:LaunchProgram,Sqritto}"; Flags: nowait postinstall skipifsilent
; Selbst-Update (src/update.rs): /RELAUNCH=1 startet das aktualisierte Programm wieder.
; Es erbt die Umgebung des Setups und damit Port und Zugangstoken der vorigen Version.
Filename: "{app}\Sqritto.exe"; Flags: nowait; Check: Relaunch

[Code]
function Relaunch: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|}') <> '';
end;
