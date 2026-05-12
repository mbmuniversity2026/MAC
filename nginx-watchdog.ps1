param()
# MAC Nginx Watchdog - runs every 2 minutes via Scheduled Task
# Restarts mac-nginx if Docker Desktop port proxy freezes

$LogFile = Join-Path $PSScriptRoot "nginx-watchdog.log"

function Write-WLog {
    param($msg)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $msg"
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

function Test-Port80 {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $ar = $tcp.BeginConnect("127.0.0.1", 80, $null, $null)
        $ok = $ar.AsyncWaitHandle.WaitOne(2000, $false)
        if (-not $ok) { $tcp.Close(); return $false }
        $tcp.EndConnect($ar)
        $stream = $tcp.GetStream()
        $CRLF = [char]13 + [char]10
        $req = "GET /nginx-health HTTP/1.0" + $CRLF + "Host: localhost" + $CRLF + $CRLF
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        $stream.ReadTimeout = 2000
        $buf = New-Object byte[] 64
        $n = $stream.Read($buf, 0, $buf.Length)
        $tcp.Close()
        return ($n -gt 0)
    } catch {
        return $false
    }
}

Write-WLog "check"

if (-not (Test-Port80)) {
    Write-WLog "WARN port 80 frozen - restarting mac-nginx"
    try {
        docker restart mac-nginx 2>&1 | Out-Null
        Start-Sleep -Seconds 3
        if (Test-Port80) {
            Write-WLog "OK nginx recovered"
        } else {
            Write-WLog "ERROR nginx still down after restart"
        }
    } catch {
        Write-WLog "ERROR docker restart failed: $_"
    }
} else {
    Write-WLog "OK healthy"
}

# Trim log to last 200 lines
try {
    $lines = Get-Content $LogFile -ErrorAction SilentlyContinue
    if ($lines.Count -gt 200) {
        ($lines | Select-Object -Last 200) | Set-Content $LogFile
    }
} catch {}
