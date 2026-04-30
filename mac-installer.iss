; ===============================================================
;  MAC - MBM AI Cloud  |  Inno Setup 6 Installer Script
;
;  Complete installer with:
;    - HOST/WORKER role selection
;    - Hardware scan (CPU, GPU, RAM, WiFi IP, OS)
;    - Docker prerequisite check
;    - SSL certificate generation & auto-trust
;    - Firewall port configuration
;    - Automatic service startup
;
;  Requires: Inno Setup 6+  (https://jrsoftware.org/isinfo.php)
; ===============================================================

#define AppName "MAC - MBM AI Cloud"
#define AppVersion "2.0.0"
#define AppPublisher "MBM University, Jodhpur"
#define AppURL "https://github.com/RamMAC17/MAC"

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
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

; ── Branding ──
SetupIconFile=mac-logo.ico
UninstallDisplayIcon={app}\mac-logo.ico
WizardImageFile=wizard_large.bmp
WizardSmallImageFile=wizard_small.bmp
WizardImageStretch=no
AppVerName=MAC v{#AppVersion} — MBM AI Cloud

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "host"; Description: "Host (Admin Server) — Full platform with database, API, and web interface"
Name: "worker"; Description: "Worker Node — Contribute GPU/CPU to an existing cluster"

[Components]
Name: "host"; Description: "MAC Host Server (Admin) — runs the full platform"; Types: host; Flags: exclusive
Name: "worker"; Description: "MAC Worker Node — GPU/CPU contribution only"; Types: worker; Flags: exclusive

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "firewall"; Description: "Open firewall ports 80, 443, 8000 for LAN access (recommended)"; GroupDescription: "Network Configuration"; Components: host; Flags: checkedonce
Name: "firewall_worker"; Description: "Open firewall port 8001 for vLLM inference"; GroupDescription: "Network Configuration"; Components: worker; Flags: checkedonce
Name: "installcert"; Description: "Install SSL certificate so Chrome trusts HTTPS (recommended)"; GroupDescription: "Network Configuration"; Components: host; Flags: checkedonce

[Files]
; ── Shared files ──
Source: "mac-logo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "logo.png"; DestDir: "{app}"; Flags: ignoreversion
Source: "logo_256.bmp"; DestDir: "{app}"; Flags: ignoreversion
Source: "logo_256.png"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "wizard_large.bmp"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "wizard_small.bmp"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; ── HOST files ──
Source: "docker-compose.yml"; DestDir: "{app}"; Flags: ignoreversion; Components: host
Source: "Dockerfile"; DestDir: "{app}"; Flags: ignoreversion; Components: host
Source: ".env.example"; DestDir: "{app}"; DestName: ".env"; Flags: ignoreversion onlyifdoesntexist; Components: host
Source: "requirements.txt"; DestDir: "{app}"; Flags: ignoreversion; Components: host
Source: "start-mac.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: host
Source: "stop-mac.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: host
Source: "mac\*"; DestDir: "{app}\mac"; Flags: ignoreversion recursesubdirs; Components: host
Source: "frontend\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs; Components: host
Source: "nginx\*"; DestDir: "{app}\nginx"; Flags: ignoreversion recursesubdirs; Components: host
Source: "alembic\*"; DestDir: "{app}\alembic"; Flags: ignoreversion recursesubdirs; Components: host
Source: "alembic.ini"; DestDir: "{app}"; Flags: ignoreversion; Components: host

; ── WORKER files ──
Source: "docker-compose.worker.yml"; DestDir: "{app}"; Flags: ignoreversion; Components: worker
Source: "worker_agent.py"; DestDir: "{app}"; Flags: ignoreversion; Components: worker
Source: "start-mac-worker.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: worker

[Icons]
; Host shortcuts
Name: "{group}\Start MAC Server"; Filename: "{app}\start-mac.bat"; WorkingDir: "{app}"; IconFilename: "{app}\mac-logo.ico"; Components: host
Name: "{group}\Stop MAC Server"; Filename: "{app}\stop-mac.bat"; WorkingDir: "{app}"; IconFilename: "{app}\mac-logo.ico"; Components: host
Name: "{autodesktop}\MAC Server"; Filename: "{app}\start-mac.bat"; WorkingDir: "{app}"; IconFilename: "{app}\mac-logo.ico"; Tasks: desktopicon; Components: host
; Worker shortcuts
Name: "{group}\Start MAC Worker"; Filename: "{app}\start-mac-worker.bat"; WorkingDir: "{app}"; IconFilename: "{app}\mac-logo.ico"; Components: worker
Name: "{autodesktop}\MAC Worker"; Filename: "{app}\start-mac-worker.bat"; WorkingDir: "{app}"; IconFilename: "{app}\mac-logo.ico"; Tasks: desktopicon; Components: worker
; Uninstall
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"; IconFilename: "{app}\mac-logo.ico"

[Run]
; ── HOST post-install: firewall ──
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""MAC Web (HTTP)"" dir=in action=allow protocol=TCP localport=80 profile=any"; Flags: runhidden waituntilterminated; Tasks: firewall; Components: host
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""MAC Web (HTTPS)"" dir=in action=allow protocol=TCP localport=443 profile=any"; Flags: runhidden waituntilterminated; Tasks: firewall; Components: host
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""MAC API (8000)"" dir=in action=allow protocol=TCP localport=8000 profile=any"; Flags: runhidden waituntilterminated; Tasks: firewall; Components: host

; ── WORKER post-install: firewall ──
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""MAC Worker vLLM"" dir=in action=allow protocol=TCP localport=8001 profile=any"; Flags: runhidden waituntilterminated; Tasks: firewall_worker; Components: worker

; ── Post-install launch (user choice) ──
Filename: "{app}\start-mac.bat"; Description: "Start MAC Server now"; Flags: nowait postinstall skipifsilent shellexec; Components: host
Filename: "{app}\start-mac-worker.bat"; Description: "Start MAC Worker now"; Flags: nowait postinstall skipifsilent shellexec; Components: worker

[UninstallRun]
Filename: "{app}\stop-mac.bat"; Flags: shellexec runhidden waituntilterminated; Components: host; RunOnceId: "StopHost"
Filename: "docker"; Parameters: "compose -f ""{app}\docker-compose.worker.yml"" down"; Flags: runhidden waituntilterminated; Components: worker; RunOnceId: "StopWorker"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\nginx\ssl"

[Messages]
WelcomeLabel1=Welcome to MAC
WelcomeLabel2=MBM AI Cloud — Self-Hosted AI Platform%n%nHi! I'm MAC, your AI assistant from MBM University, Jodhpur!%n%nThis will install MAC v{#AppVersion} on your computer.%n%nYou will choose to install as:%n  %u2022 HOST — Full admin server (database, API, web UI, AI models)%n  %u2022 WORKER — Contribute your GPU/CPU to an existing cluster%n%nRequirements:%n  %u2022 Docker Desktop (will be checked)%n  %u2022 NVIDIA GPU + drivers (for AI inference)%n  %u2022 8 GB RAM minimum

[Code]
var
  HardwareInfoPage: TWizardPage;
  ReadyInfoPage: TWizardPage;
  HwMemo: TNewMemo;
  ReadyMemo: TNewMemo;
  RoleLabel: TNewStaticText;
  ReadyLabel: TNewStaticText;
  DetectedIP: String;
  MascotLabel: TNewStaticText;

{ ═══════════════════════════════════════════════════════════
  UTILITY: Run a command, capture stdout to file, read it back
  ═══════════════════════════════════════════════════════════ }
procedure RunAndCapture(const Cmd, Params, TmpFile: String; var Output: String);
var
  RC: Integer;
  Lines: TArrayOfString;
  I: Integer;
begin
  Output := '';
  Exec('cmd.exe', '/C ' + Cmd + ' ' + Params + ' > "' + TmpFile + '" 2>&1',
       '', SW_HIDE, ewWaitUntilTerminated, RC);
  if LoadStringsFromFile(TmpFile, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do
    begin
      if Output <> '' then Output := Output + #13#10;
      Output := Output + Lines[I];
    end;
  DeleteFile(TmpFile);
end;

{ ═══════════════════════════════════════════════════════════
  HARDWARE SCAN — CPU, GPU (with NVIDIA VRAM), RAM, IP, OS
  ═══════════════════════════════════════════════════════════ }
function GetHardwareInfo: String;
var
  TmpDir, TmpFile, CpuOut, GpuOut, NvidiaOut, RamOut, IpOut, OsOut: String;
begin
  TmpDir := ExpandConstant('{tmp}');

  { CPU — name, cores, threads }
  TmpFile := TmpDir + '\mac_cpu.txt';
  RunAndCapture('wmic', 'cpu get Name,NumberOfCores,NumberOfLogicalProcessors /format:list', TmpFile, CpuOut);

  { GPU — via WMIC }
  TmpFile := TmpDir + '\mac_gpu.txt';
  RunAndCapture('wmic', 'path win32_VideoController get Name,AdapterRAM /format:list', TmpFile, GpuOut);

  { GPU — NVIDIA specific (nvidia-smi for accurate VRAM) }
  TmpFile := TmpDir + '\mac_nvidia.txt';
  RunAndCapture('nvidia-smi', '--query-gpu=name,memory.total,driver_version --format=csv,noheader', TmpFile, NvidiaOut);
  if Trim(NvidiaOut) = '' then
    NvidiaOut := '(NVIDIA GPU not detected or drivers not installed)';

  { RAM }
  TmpFile := TmpDir + '\mac_ram.txt';
  RunAndCapture('powershell', '-NoProfile -Command "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1).ToString() + '' GB''"', TmpFile, RamOut);

  { WiFi/LAN IP — skip Docker, WSL, Hyper-V virtual adapters }
  TmpFile := TmpDir + '\mac_ip.txt';
  RunAndCapture('powershell', '-NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch ''Loopback|vEthernet|WSL|Docker|Hyper-V'' -and $_.IPAddress -ne ''127.0.0.1'' -and $_.PrefixOrigin -ne ''WellKnown'' } | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress"', TmpFile, IpOut);
  DetectedIP := Trim(IpOut);
  if DetectedIP = '' then DetectedIP := '(not detected)';

  { OS }
  TmpFile := TmpDir + '\mac_os.txt';
  RunAndCapture('powershell', '-NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption + '' '' + (Get-CimInstance Win32_OperatingSystem).Version"', TmpFile, OsOut);

  Result := '  SYSTEM HARDWARE SCAN' + #13#10;
  Result := Result + '  =======================================' + #13#10;
  Result := Result + '' + #13#10;
  Result := Result + '  CPU' + #13#10;
  Result := Result + '  ---' + #13#10;
  Result := Result + '  ' + CpuOut + #13#10;
  Result := Result + '' + #13#10;
  Result := Result + '  GPU (NVIDIA)' + #13#10;
  Result := Result + '  ---' + #13#10;
  Result := Result + '  ' + NvidiaOut + #13#10;
  Result := Result + '' + #13#10;
  Result := Result + '  GPU (All)' + #13#10;
  Result := Result + '  ---' + #13#10;
  Result := Result + '  ' + GpuOut + #13#10;
  Result := Result + '' + #13#10;
  Result := Result + '  RAM' + #13#10;
  Result := Result + '  ---' + #13#10;
  Result := Result + '  ' + Trim(RamOut) + #13#10;
  Result := Result + '' + #13#10;
  Result := Result + '  NETWORK (WiFi/LAN)' + #13#10;
  Result := Result + '  ---' + #13#10;
  Result := Result + '  IPv4 Address: ' + DetectedIP + #13#10;
  Result := Result + '' + #13#10;
  Result := Result + '  OS' + #13#10;
  Result := Result + '  ---' + #13#10;
  Result := Result + '  ' + Trim(OsOut);
end;

{ ═══════════════════════════════════════════════════════════
  DOCKER CHECK — verify Docker Desktop is installed & running
  ═══════════════════════════════════════════════════════════ }
function CheckDockerInstalled(): Boolean;
var
  RC: Integer;
begin
  Result := Exec('docker', 'info', '', SW_HIDE, ewWaitUntilTerminated, RC);
  if not Result then
  begin
    if MsgBox(
      'Docker Desktop is required but was not detected.' + #13#10 + #13#10 +
      'MAC needs Docker to run its services (database, AI models, web server).' + #13#10 + #13#10 +
      'Would you like to continue anyway?' + #13#10 +
      '(You can install Docker later from https://docker.com/products/docker-desktop)',
      mbConfirmation, MB_YESNO) = IDYES then
      Result := True;
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := CheckDockerInstalled();
end;

{ ═══════════════════════════════════════════════════════════
  WIZARD PAGES — Hardware scan + Ready summary
  ═══════════════════════════════════════════════════════════ }
procedure InitializeWizard();
begin
  { Static MAC mascot on welcome page (no TTimer — not supported in Pascal Script) }
  MascotLabel := TNewStaticText.Create(WizardForm);
  MascotLabel.Parent := WizardForm.WelcomePage;
  MascotLabel.Left := 185;
  MascotLabel.Top := 250;
  MascotLabel.Width := 320;
  MascotLabel.Height := 160;
  MascotLabel.Font.Name := 'Consolas';
  MascotLabel.Font.Size := 9;
  MascotLabel.Font.Color := $003A70C2;
  MascotLabel.Caption :=
    '            .---.           ' + #13#10 +
    '           / o o \          ' + #13#10 +
    '          |  ___  |         ' + #13#10 +
    '          | |   | |         ' + #13#10 +
    '           \ `-'' /          ' + #13#10 +
    '            `---''           ' + #13#10 +
    '           /|   |\          ' + #13#10 +
    '          / |   | \         ' + #13#10 +
    '' + #13#10 +
    '   Welcome, I am MAC!      ' + #13#10 +
    '   Your AI Cloud Assistant ' + #13#10 +
    '   from MBM University     ';

  { Page 1: Hardware info — shown after component selection }
  HardwareInfoPage := CreateCustomPage(
    wpSelectComponents,
    'System Hardware Scan',
    'MAC has detected the following hardware on this PC. Verify your GPU is listed for AI inference.');

  RoleLabel := TNewStaticText.Create(HardwareInfoPage);
  RoleLabel.Parent := HardwareInfoPage.Surface;
  RoleLabel.Left := 0;
  RoleLabel.Top := 0;
  RoleLabel.Width := HardwareInfoPage.SurfaceWidth;
  RoleLabel.Caption := 'Scanning hardware...';
  RoleLabel.Font.Style := [fsBold];
  RoleLabel.Font.Size := 10;
  RoleLabel.Font.Color := $003A70C2;

  HwMemo := TNewMemo.Create(HardwareInfoPage);
  HwMemo.Parent := HardwareInfoPage.Surface;
  HwMemo.Left := 0;
  HwMemo.Top := 28;
  HwMemo.Width := HardwareInfoPage.SurfaceWidth;
  HwMemo.Height := HardwareInfoPage.SurfaceHeight - 32;
  HwMemo.ReadOnly := True;
  HwMemo.ScrollBars := ssVertical;
  HwMemo.Font.Name := 'Consolas';
  HwMemo.Font.Size := 9;
  HwMemo.Text := '  (scanning hardware — this takes a few seconds...)';

  { Page 2: Ready summary — shown just before install begins }
  ReadyInfoPage := CreateCustomPage(
    wpReady,
    'Ready to Install',
    'Review what MAC will do on this PC, then click Install.');

  ReadyLabel := TNewStaticText.Create(ReadyInfoPage);
  ReadyLabel.Parent := ReadyInfoPage.Surface;
  ReadyLabel.Left := 0;
  ReadyLabel.Top := 0;
  ReadyLabel.Width := ReadyInfoPage.SurfaceWidth;
  ReadyLabel.Font.Style := [fsBold];
  ReadyLabel.Font.Size := 10;
  ReadyLabel.Font.Color := $003A70C2;

  ReadyMemo := TNewMemo.Create(ReadyInfoPage);
  ReadyMemo.Parent := ReadyInfoPage.Surface;
  ReadyMemo.Left := 0;
  ReadyMemo.Top := 28;
  ReadyMemo.Width := ReadyInfoPage.SurfaceWidth;
  ReadyMemo.Height := ReadyInfoPage.SurfaceHeight - 32;
  ReadyMemo.ReadOnly := True;
  ReadyMemo.ScrollBars := ssVertical;
  ReadyMemo.Font.Name := 'Consolas';
  ReadyMemo.Font.Size := 9;
end;

{ ═══════════════════════════════════════════════════════════
  PAGE CHANGE HANDLER — populate hardware scan + ready summary
  ═══════════════════════════════════════════════════════════ }
procedure CurPageChanged(CurPageID: Integer);
var
  Summary: String;
begin
  { Hardware scan page }
  if CurPageID = HardwareInfoPage.ID then
  begin
    HwMemo.Text := GetHardwareInfo;
    if WizardIsComponentSelected('host') then
      RoleLabel.Caption := 'Role:  HOST (Admin Server)  —  WiFi IP: ' + DetectedIP
    else
      RoleLabel.Caption := 'Role:  WORKER Node';
  end;

  { Ready summary page }
  if CurPageID = ReadyInfoPage.ID then
  begin
    if WizardIsComponentSelected('host') then
    begin
      ReadyLabel.Caption := 'HOST Installation Summary';
      Summary := '  The installer will now:' + #13#10;
      Summary := Summary + '' + #13#10;
      Summary := Summary + '  1. Copy MAC platform files to:' + #13#10;
      Summary := Summary + '     ' + ExpandConstant('{app}') + #13#10;
      Summary := Summary + '' + #13#10;
      if WizardIsTaskSelected('firewall') then
      begin
        Summary := Summary + '  2. Open firewall ports:' + #13#10;
        Summary := Summary + '     - Port 80   (HTTP)' + #13#10;
        Summary := Summary + '     - Port 443  (HTTPS / PWA install)' + #13#10;
        Summary := Summary + '     - Port 8000 (API direct access)' + #13#10;
        Summary := Summary + '' + #13#10;
      end;
      Summary := Summary + '  3. On first launch (start-mac.bat):' + #13#10;
      Summary := Summary + '     - Auto-detect WiFi IP' + #13#10;
      Summary := Summary + '     - Generate SSL certificates for HTTPS' + #13#10;
      Summary := Summary + '     - Install CA cert so Chrome trusts HTTPS' + #13#10;
      Summary := Summary + '     - Pull Docker images (first run only)' + #13#10;
      Summary := Summary + '     - Start all services' + #13#10;
      Summary := Summary + '' + #13#10;
      Summary := Summary + '  After install, other devices on your WiFi can:' + #13#10;
      Summary := Summary + '     1. Open  http://' + DetectedIP + '/install-cert' + #13#10;
      Summary := Summary + '     2. Install the CA certificate (one-time)' + #13#10;
      Summary := Summary + '     3. Open  https://' + DetectedIP + '  and install as app!' + #13#10;
      Summary := Summary + '' + #13#10;
      Summary := Summary + '  Desktop shortcut: "MAC Server"' + #13#10;
      Summary := Summary + '  Start menu: Start MAC Server / Stop MAC Server';
    end
    else
    begin
      ReadyLabel.Caption := 'WORKER Installation Summary';
      Summary := '  The installer will now:' + #13#10;
      Summary := Summary + '' + #13#10;
      Summary := Summary + '  1. Copy worker agent files to:' + #13#10;
      Summary := Summary + '     ' + ExpandConstant('{app}') + #13#10;
      Summary := Summary + '' + #13#10;
      if WizardIsTaskSelected('firewall_worker') then
      begin
        Summary := Summary + '  2. Open firewall port 8001 (vLLM inference)' + #13#10;
        Summary := Summary + '' + #13#10;
      end;
      Summary := Summary + '  3. On first launch you will be asked for:' + #13#10;
      Summary := Summary + '     - Admin server IP address' + #13#10;
      Summary := Summary + '     - Enrollment token (from admin panel)' + #13#10;
      Summary := Summary + '     - Worker name (e.g. Lab-PC-01)' + #13#10;
      Summary := Summary + '' + #13#10;
      Summary := Summary + '  Desktop shortcut: "MAC Worker"';
    end;
    ReadyMemo.Text := Summary;
  end;
end;

{ ═══════════════════════════════════════════════════════════
  POST-INSTALL: Generate SSL + install CA cert for HOST
  ═══════════════════════════════════════════════════════════ }
procedure CurStepChanged(CurStep: TSetupStep);
var
  RC: Integer;
  AppDir, SslDir, CaCrtPath: String;
begin
  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');
    SslDir := AppDir + '\nginx\ssl';
    CaCrtPath := SslDir + '\ca.crt';

    if WizardIsComponentSelected('host') then
    begin
      { Generate SSL certs if they don't exist yet }
      if not FileExists(CaCrtPath) then
      begin
        WizardForm.StatusLabel.Caption := 'Generating SSL certificates...';
        ForceDirectories(SslDir);

        { Try local Python first }
        if not Exec('python',
          '-c "exec(open(''' + AppDir + '\mac\services\_gen_ssl_startup.py'').read())" "' + DetectedIP + '"',
          AppDir, SW_HIDE, ewWaitUntilTerminated, RC) or (RC <> 0) then
        begin
          { Fallback: Docker python }
          Exec('docker',
            'run --rm -v "' + SslDir + ':/ssl" -v "' + AppDir + '\mac\services\_gen_ssl_startup.py:/gen.py:ro" python:3.11-slim sh -c "pip install cryptography -q && python /gen.py ' + DetectedIP + ' /ssl"',
            AppDir, SW_HIDE, ewWaitUntilTerminated, RC);
        end;
      end;

      { Install CA certificate to trusted store }
      if WizardIsTaskSelected('installcert') and FileExists(CaCrtPath) then
      begin
        WizardForm.StatusLabel.Caption := 'Installing CA certificate...';
        Exec('certutil', '-user -addstore "Root" "' + CaCrtPath + '"',
          '', SW_SHOW, ewWaitUntilTerminated, RC);
      end;
    end;
  end;
end;
