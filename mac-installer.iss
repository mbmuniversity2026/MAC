; MAC — MBM AI Cloud  |  Inno Setup 6 Installer Script
; Packages the Docker Compose project for Windows deployment.
; Requires: Inno Setup 6+  (https://jrsoftware.org/isinfo.php)

#define AppName "MAC — MBM AI Cloud"
#define AppVersion "1.0.0"
#define AppPublisher "MBM University, Jodhpur"
#define AppURL "https://github.com/RamMAC17/MAC"
#define AppExeName "start-mac.bat"

[Setup]
AppId={{A8F3C2E1-4B7D-4F2A-9C8E-1D5F6A3B2E7C}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\MAC
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=MAC-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Require admin for program files installation
PrivilegesRequired=admin
; Architecture
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Core project files
Source: "docker-compose.yml"; DestDir: "{app}"; Flags: ignoreversion
Source: "Dockerfile"; DestDir: "{app}"; Flags: ignoreversion
Source: ".env.example"; DestDir: "{app}"; DestName: ".env"; Flags: ignoreversion onlyifdoesntexist
Source: "requirements.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-mac.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-mac.bat"; DestDir: "{app}"; Flags: ignoreversion

; Python backend
Source: "mac\*"; DestDir: "{app}\mac"; Flags: ignoreversion recursesubdirs

; Frontend (vanilla JS — no build step)
Source: "frontend\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs

; Nginx config
Source: "nginx\*"; DestDir: "{app}\nginx"; Flags: ignoreversion recursesubdirs

; Alembic migrations
Source: "alembic\*"; DestDir: "{app}\alembic"; Flags: ignoreversion recursesubdirs
Source: "alembic.ini"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Start MAC"; Filename: "{app}\start-mac.bat"; WorkingDir: "{app}"; IconFilename: "{app}\frontend\icon-64.png"
Name: "{group}\Stop MAC"; Filename: "{app}\stop-mac.bat"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Start MAC"; Filename: "{app}\start-mac.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\start-mac.bat"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
Filename: "{app}\stop-mac.bat"; Flags: shellexec runhidden waituntilterminated

[Code]
function CheckDockerInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('docker', 'info', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if not Result then
    MsgBox('Docker Desktop is not installed or not running. Please install Docker Desktop from https://www.docker.com/products/docker-desktop and start it before running MAC.', mbError, MB_OK);
end;

function InitializeSetup(): Boolean;
begin
  Result := CheckDockerInstalled();
end;
