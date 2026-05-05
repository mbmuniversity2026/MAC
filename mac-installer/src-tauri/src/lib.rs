use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct HardwareInfo {
    cpu_name: String,
    cpu_cores: String,
    gpu_name: String,
    gpu_vram: String,
    nvidia_driver: String,
    ram_total: String,
    ip_address: String,
    os_name: String,
    docker_installed: bool,
    docker_version: String,
}

fn run_cmd(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn scan_hardware() -> HardwareInfo {
    let cpu_name = run_cmd("powershell", &["-NoProfile", "-Command",
        "(Get-CimInstance Win32_Processor).Name"]);
    let cpu_cores = run_cmd("powershell", &["-NoProfile", "-Command",
        "(Get-CimInstance Win32_Processor | Select-Object -First 1).NumberOfLogicalProcessors"]);
    
    let nvidia = run_cmd("nvidia-smi", &[
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits"
    ]);
    let (gpu_name, gpu_vram, nvidia_driver) = if !nvidia.is_empty() {
        let parts: Vec<&str> = nvidia.split(',').map(|s| s.trim()).collect();
        (
            parts.get(0).unwrap_or(&"").to_string(),
            format!("{} MB", parts.get(1).unwrap_or(&"0")),
            parts.get(2).unwrap_or(&"").to_string(),
        )
    } else {
        let wmic_gpu = run_cmd("powershell", &["-NoProfile", "-Command",
            "(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name"]);
        (wmic_gpu, "N/A".into(), "Not installed".into())
    };
    
    let ram_total = run_cmd("powershell", &["-NoProfile", "-Command",
        "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1).ToString() + ' GB'"]);
    
    let ip_address = run_cmd("powershell", &["-NoProfile", "-Command",
        "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress"]);
    
    let os_name = run_cmd("powershell", &["-NoProfile", "-Command",
        "(Get-CimInstance Win32_OperatingSystem).Caption"]);
    
    let docker_ver = run_cmd("docker", &["--version"]);
    let docker_installed = !docker_ver.is_empty();
    
    HardwareInfo {
        cpu_name, cpu_cores, gpu_name, gpu_vram, nvidia_driver,
        ram_total, ip_address, os_name, docker_installed,
        docker_version: if docker_installed { docker_ver } else { "Not installed".into() },
    }
}

#[tauri::command]
fn install_docker() -> Result<String, String> {
    let output = Command::new("winget")
        .args(["install", "-e", "--id", "Docker.DockerDesktop",
               "--accept-source-agreements", "--accept-package-agreements", "--silent"])
        .output()
        .map_err(|e| format!("Failed to run winget: {}", e))?;
    
    if output.status.success() {
        Ok("Docker Desktop installed successfully. Restart required.".into())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Docker install failed: {}", stderr))
    }
}

#[tauri::command]
fn open_firewall(ports: Vec<u16>) -> Result<String, String> {
    for port in &ports {
        let _ = Command::new("netsh")
            .args(["advfirewall", "firewall", "add", "rule",
                   &format!("name=MAC Port {}", port), "dir=in", "action=allow",
                   "protocol=TCP", &format!("localport={}", port), "profile=any"])
            .output();
    }
    Ok(format!("Firewall ports opened: {:?}", ports))
}

#[tauri::command]
fn start_services(install_dir: String, role: String) -> Result<String, String> {
    let compose_file = if role == "worker" {
        "docker-compose.worker.yml"
    } else {
        "docker-compose.yml"
    };
    
    let output = Command::new("docker")
        .args(["compose", "-f", compose_file, "up", "-d"])
        .current_dir(&install_dir)
        .output()
        .map_err(|e| format!("Failed to start services: {}", e))?;
    
    if output.status.success() {
        Ok("Services started successfully".into())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Service start failed: {}", stderr))
    }
}

#[tauri::command]
fn copy_files(source: String, dest: String) -> Result<String, String> {
    std::fs::create_dir_all(&dest).map_err(|e| format!("Cannot create dir: {}", e))?;
    
    let output = Command::new("robocopy")
        .args([&source, &dest, "/E", "/MIR", "/NP", "/NFL", "/NDL",
               "/XD", "node_modules", ".git", "__pycache__", "models"])
        .output()
        .map_err(|e| format!("Robocopy failed: {}", e))?;
    
    // robocopy returns 0-7 for success
    if output.status.code().unwrap_or(8) < 8 {
        Ok("Files copied successfully".into())
    } else {
        Err("File copy failed".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_hardware,
            install_docker,
            open_firewall,
            start_services,
            copy_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
