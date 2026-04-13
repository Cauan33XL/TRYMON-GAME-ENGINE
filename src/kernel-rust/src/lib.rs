//! # TRYMON Kernel Rust Module
//! 
//! Kernel-level Rust module for loading and executing Linux binaries
//! (.AppImage, .deb, .rpm) in a WASM-based virtualized environment.

#![warn(missing_docs)]
#![allow(clippy::missing_safety_doc)]

use wasm_bindgen::prelude::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;

mod binary_loader;
mod virtual_fs;
mod process_manager;
mod shell;
mod kernel_api;
mod error;

pub use binary_loader::*;
pub use virtual_fs::*;
pub use process_manager::*;
pub use kernel_api::*;
pub use error::*;

// Global kernel state
static KERNEL: Lazy<Mutex<Option<TrymonKernel>>> = Lazy::new(|| Mutex::new(None));

/// Main kernel structure - holds all subsystems
pub struct TrymonKernel {
    /// Binary loader subsystem
    pub loader: BinaryLoader,
    /// Virtual filesystem
    pub vfs: VirtualFileSystem,
    /// Process manager
    pub processes: ProcessManager,
    /// Interactive shell
    pub shell: shell::Shell,
    /// Kernel configuration
    pub config: KernelConfig,
    /// Kernel uptime (seconds)
    pub uptime: u64,
}

/// Kernel configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KernelConfig {
    /// Maximum memory allocation (MB)
    pub max_memory_mb: u32,
    /// Enable network access
    pub enable_network: bool,
    /// Enable sound emulation
    pub enable_sound: bool,
    /// Log level (0-3)
    pub log_level: u8,
    /// Security sandbox enabled
    pub sandbox_enabled: bool,
    /// Maximum number of concurrent processes
    pub max_processes: u32,
}

impl Default for KernelConfig {
    fn default() -> Self {
        Self {
            max_memory_mb: 128,
            enable_network: false,
            enable_sound: false,
            log_level: 1,
            sandbox_enabled: true,
            max_processes: 10,
        }
    }
}

impl TrymonKernel {
    /// Create a new kernel instance
    pub fn new(config: KernelConfig) -> Self {
        Self {
            loader: BinaryLoader::new(),
            vfs: VirtualFileSystem::new(),
            processes: ProcessManager::new(config.max_processes),
            shell: shell::Shell::new(),
            config,
            uptime: 0,
        }
    }

    /// Initialize kernel subsystems
    pub fn init(&mut self) -> crate::error::Result<()> {
        log::info!("TRYMON Kernel initializing...");
        
        self.loader.init()?;
        self.vfs.init()?;
        self.processes.init()?;
        
        log::info!("TRYMON Kernel ready!");
        Ok(())
    }
}

// ============================================================
// WASM Export Functions
// ============================================================

/// Initialize the TRYMON kernel
#[wasm_bindgen]
pub fn kernel_init() -> std::result::Result<(), JsValue> {
    let mut kernel = TrymonKernel::new(KernelConfig::default());
    kernel.init().map_err(JsValue::from)?;
    
    *KERNEL.lock() = Some(kernel);
    Ok(())
}

/// Load a binary file into the kernel
#[wasm_bindgen]
pub fn kernel_load_binary(name: &str, data: &[u8]) -> std::result::Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut().ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;
    
    kernel.loader.load_binary(name, data)
        .map(|info| serde_json::to_string(&info).unwrap_or_default())
        .map_err(JsValue::from)
}

/// Execute a loaded binary
#[wasm_bindgen]
pub fn kernel_execute_binary(binary_id: &str) -> std::result::Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut().ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;
    
    kernel.processes.execute_binary(&kernel.loader, &mut kernel.vfs, binary_id)
        .map(|info| serde_json::to_string(&info).unwrap_or_default())
        .map_err(JsValue::from)
}

/// Get kernel status
#[wasm_bindgen]
pub fn kernel_status() -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => {
            let status = KernelStatus {
                initialized: true,
                uptime: kernel.uptime,
                loaded_binaries: kernel.loader.loaded_binaries(),
                running_processes: kernel.processes.running_count(),
                memory_usage: kernel.processes.memory_usage(),
                config: kernel.config.clone(),
            };
            serde_json::to_string(&status).unwrap_or_default()
        }
        None => {
            serde_json::to_string(&KernelStatus {
                initialized: false,
                uptime: 0,
                loaded_binaries: vec![],
                running_processes: 0,
                memory_usage: 0,
                config: KernelConfig::default(),
            }).unwrap_or_default()
        }
    }
}

/// Stop a running process
#[wasm_bindgen]
pub fn kernel_stop_process(process_id: &str) -> std::result::Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut().ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;
    
    kernel.processes.stop_process(process_id)
        .map_err(JsValue::from)
}

/// List all running processes
#[wasm_bindgen]
pub fn kernel_list_processes() -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => {
            let processes = kernel.processes.list_processes();
            serde_json::to_string(&processes).unwrap_or_default()
        }
        None => "[]".to_string()
    }
}

/// Get terminal output from a process
#[wasm_bindgen]
pub fn kernel_get_output(process_id: &str) -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => kernel.processes.get_output(process_id).unwrap_or_default(),
        None => String::new()
    }
}

/// Send input to a process
#[wasm_bindgen]
pub fn kernel_send_input(process_id: &str, input: &str) -> std::result::Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k.as_mut().ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;
    
    kernel.processes.send_input(process_id, input)
        .map_err(JsValue::from)
}

// Kernel status structure for JSON serialization
#[derive(serde::Serialize)]
struct KernelStatus {
    initialized: bool,
    uptime: u64,
    loaded_binaries: Vec<BinaryInfo>,
    running_processes: usize,
    memory_usage: u64,
    config: KernelConfig,
}
