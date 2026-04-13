//! Kernel API Module
//! 
//! High-level API functions exposed to JavaScript via WASM bindings.
//! This module provides the interface between the web frontend and kernel.

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use crate::{TrymonKernel, KernelConfig, KERNEL};

/// Initialize kernel with configuration
#[wasm_bindgen]
pub fn api_kernel_init(config_json: &str) -> Result<String, JsValue> {
    let config: KernelConfig = if config_json.is_empty() {
        KernelConfig::default()
    } else {
        serde_json::from_str(config_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid config JSON: {}", e)))?
    };

    let mut kernel = TrymonKernel::new(config);
    kernel.init()
        .map_err(JsValue::from)?;

    *KERNEL.lock() = Some(kernel);
    
    Ok("{\"status\": \"ok\", \"message\": \"Kernel initialized\"}".to_string())
}

/// Load and register a binary
#[wasm_bindgen]
pub fn api_load_binary(name: &str, data: Vec<u8>) -> Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel.loader.load_binary(name, &data)
        .map(|info| serde_json::to_string(&info).unwrap_or_default())
        .map_err(JsValue::from)
}

/// Execute a loaded binary
#[wasm_bindgen]
pub fn api_execute_binary(binary_id: &str, _args: &str) -> Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel.processes.execute_binary(&kernel.loader, &mut kernel.vfs, binary_id)
        .map(|info| serde_json::to_string(&info).unwrap_or_default())
        .map_err(JsValue::from)
}

/// Stop a running process
#[wasm_bindgen]
pub fn api_stop_process(pid: &str) -> Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel.processes.stop_process(pid)
        .map_err(JsValue::from)
}

/// Send input to a process
#[wasm_bindgen]
pub fn api_send_input(pid: &str, input: &str) -> Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel.processes.send_input(pid, input)
        .map_err(JsValue::from)
}

/// Get process output
#[wasm_bindgen]
pub fn api_get_output(pid: &str) -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => kernel.processes.get_output(pid).unwrap_or_default(),
        None => String::new()
    }
}

/// List all processes
#[wasm_bindgen]
pub fn api_list_processes() -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => {
            let processes = kernel.processes.list_processes();
            serde_json::to_string(&processes).unwrap_or_default()
        }
        None => "[]".to_string()
    }
}

/// Get kernel status
#[wasm_bindgen]
pub fn api_get_status() -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => {
            let status = KernelStatusResponse {
                initialized: true,
                uptime: kernel.uptime,
                loaded_binaries: kernel.loader.loaded_binaries().len(),
                running_processes: kernel.processes.running_count(),
                memory_usage_bytes: kernel.processes.memory_usage(),
                filesystem_stats: kernel.vfs.stats(),
                config: kernel.config.clone(),
            };
            serde_json::to_string(&status).unwrap_or_default()
        }
        None => {
            serde_json::to_string(&KernelStatusResponse {
                initialized: false,
                uptime: 0,
                loaded_binaries: 0,
                running_processes: 0,
                memory_usage_bytes: 0,
                filesystem_stats: crate::virtual_fs::FileSystemStats {
                    total_files: 0,
                    total_directories: 0,
                    total_size: 0,
                    mount_points: 0,
                },
                config: crate::KernelConfig::default(),
            }).unwrap_or_default()
        }
    }
}

/// Mount a filesystem
#[wasm_bindgen]
pub fn api_mount(path: &str, source: &str, fs_type: &str) -> Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel.vfs.mount(path, source, fs_type)
        .map_err(JsValue::from)
}

/// Unmount a filesystem
#[wasm_bindgen]
pub fn api_unmount(path: &str) -> Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel.vfs.unmount(path)
        .map_err(JsValue::from)
}

/// List files in a directory
#[wasm_bindgen]
pub fn api_list_dir(path: &str) -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => {
            match kernel.vfs.list_directory(path) {
                Ok(files) => serde_json::to_string(&files).unwrap_or_default(),
                Err(_) => "[]".to_string()
            }
        }
        None => "[]".to_string()
    }
}

/// Read a file's content
#[wasm_bindgen]
pub fn api_read_file(path: &str) -> Result<Vec<u8>, JsValue> {
    let k = KERNEL.lock();
    let kernel = k.as_ref()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel.vfs.read_file(path)
        .map_err(JsValue::from)
}

/// Tick the kernel (call periodically for process updates)
#[wasm_bindgen]
pub fn api_tick() {
    let mut k = KERNEL.lock();
    if let Some(kernel) = k.as_mut() {
        kernel.processes.tick();
        kernel.uptime += 1;
    }
}

/// Send input to the interactive shell
#[wasm_bindgen]
pub fn api_shell_input(input: &str) -> String {
    let mut k = KERNEL.lock();
    match k.as_mut() {
        Some(kernel) => {
            kernel.shell.handle_input(
                input, 
                &mut kernel.vfs, 
                &mut kernel.processes, 
                &kernel.loader
            )
        }
        None => "Error: Kernel not initialized\n".to_string()
    }
}

/// Get the current shell prompt
#[wasm_bindgen]
pub fn api_shell_get_prompt() -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => kernel.shell.get_prompt().to_string(),
        None => "# ".to_string()
    }
}

// ============================================================
// Response types
// ============================================================

/// Kernel status response
#[derive(Serialize, Deserialize)]
pub struct KernelStatusResponse {
    /// Is kernel initialized
    pub initialized: bool,
    /// Kernel uptime (seconds)
    pub uptime: u64,
    /// Number of loaded binaries
    pub loaded_binaries: usize,
    /// Number of running processes
    pub running_processes: usize,
    /// Total memory usage in bytes
    pub memory_usage_bytes: u64,
    /// Filesystem statistics
    pub filesystem_stats: crate::virtual_fs::FileSystemStats,
    /// Kernel configuration
    pub config: crate::KernelConfig,
}
