//! # TRYMON Kernel Rust Module
//!
//! Kernel-level Rust module for loading and executing Linux binaries
//! (.AppImage, .deb, .rpm) in a WASM-based virtualized environment.

#![warn(missing_docs)]
#![allow(clippy::missing_safety_doc)]

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use wasm_bindgen::prelude::*;

mod binary_loader;
mod error;
mod kernel_api;
mod process_manager;
mod shell;
mod trymon_engine;
pub mod tvm;
mod virtual_fs;

pub use binary_loader::*;
pub use error::*;
pub use kernel_api::*;
pub use process_manager::*;
pub use trymon_engine::*;
pub use virtual_fs::*;

/// Kernel operational states
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SystemState {
    /// Booting and initializing subsystems
    Booting,
    /// Minimum subsystems ready
    Ready,
    /// Fully operational with GUI support
    Running,
    /// System is shutting down
    ShuttingDown,
    /// System has stopped
    Halted,
}

/// Kernel status information for the frontend
#[derive(serde::Serialize)]
pub struct SystemInfo {
    /// Current state of the system
    pub state: SystemState,
    /// System uptime in seconds
    pub uptime: u64,
    /// Collection of boot logs
    pub boot_logs: Vec<String>,
    /// Current memory usage in bytes
    pub memory_usage: u64,
}

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
    /// Trymon execution engine
    pub engine: TrymonEngine,
    /// Kernel configuration
    pub config: KernelConfig,
    /// Kernel uptime (seconds)
    pub uptime: u64,
    /// Current system state
    pub state: SystemState,
    /// Boot logs
    pub boot_logs: Vec<String>,
}

/// Kernel configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KernelConfig {
    /// Maximum memory allocation (MB)
    #[serde(default = "default_max_memory_mb")]
    pub max_memory_mb: u32,
    /// Enable network access
    #[serde(default)]
    pub enable_network: bool,
    /// Enable sound emulation
    #[serde(default)]
    pub enable_sound: bool,
    /// Log level (0-3)
    #[serde(default = "default_log_level")]
    pub log_level: u8,
    /// Security sandbox enabled
    #[serde(default = "default_sandbox_enabled")]
    pub sandbox_enabled: bool,
    /// Maximum number of concurrent processes
    #[serde(default = "default_max_processes")]
    pub max_processes: u32,
}

fn default_max_memory_mb() -> u32 {
    128
}
fn default_log_level() -> u8 {
    1
}
fn default_sandbox_enabled() -> bool {
    true
}
fn default_max_processes() -> u32 {
    10
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
            engine: TrymonEngine::new(),
            config,
            uptime: 0,
            state: SystemState::Booting,
            boot_logs: vec!["[ KERNEL ] Starting Trymon Kernel...".into()],
        }
    }

    /// Add a message to boot logs
    pub fn log_boot(&mut self, msg: &str) {
        let log_msg = format!("[ KERNEL ] {}", msg);
        log::info!("{}", log_msg);
        self.boot_logs.push(log_msg);
    }

    /// Initialize kernel subsystems
    pub fn init(&mut self) -> crate::error::Result<()> {
        self.log_boot("Initializing subsystems...");

        self.log_boot("Loading BinaryLoader...");
        self.loader.init()?;

        self.log_boot("Mounting VirtualFileSystem...");
        self.vfs.init()?;

        self.log_boot("Starting ProcessManager...");
        self.processes.init()?;

        self.log_boot("Initializing TrymonEngine...");
        self.engine.init(&mut self.vfs)?;

        self.state = SystemState::Running;
        self.log_boot("System is RUNNING");

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
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel
        .loader
        .load_binary(name, data)
        .map(|info| serde_json::to_string(&info).unwrap_or_default())
        .map_err(JsValue::from)
}

/// Execute a loaded binary
#[wasm_bindgen]
pub fn kernel_execute_binary(binary_id: &str) -> std::result::Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel
        .processes
        .execute_binary(&kernel.loader, &mut kernel.vfs, binary_id)
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
        None => serde_json::to_string(&KernelStatus {
            initialized: false,
            uptime: 0,
            loaded_binaries: vec![],
            running_processes: 0,
            memory_usage: 0,
            config: KernelConfig::default(),
        })
        .unwrap_or_default(),
    }
}

/// Stop a running process
#[wasm_bindgen]
pub fn kernel_stop_process(process_id: &str) -> std::result::Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel
        .processes
        .stop_process(process_id)
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
        None => "[]".to_string(),
    }
}

/// Get terminal output from a process
#[wasm_bindgen]
pub fn kernel_get_output(process_id: &str) -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => kernel.processes.get_output(process_id).unwrap_or_default(),
        None => String::new(),
    }
}

/// Send input to a process
#[wasm_bindgen]
pub fn kernel_send_input(process_id: &str, input: &str) -> std::result::Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel
        .processes
        .send_input(process_id, input)
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

/// Install a loaded .trymon package
#[wasm_bindgen]
pub fn kernel_trymon_install(binary_id: &str) -> std::result::Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    kernel
        .engine
        .install_package(&mut kernel.vfs, &kernel.loader, binary_id)
        .map(|info| serde_json::to_string(&info).unwrap_or_default())
        .map_err(JsValue::from)
}

/// List all installed Trymon apps
#[wasm_bindgen]
pub fn kernel_trymon_list_apps() -> String {
    let k = KERNEL.lock();
    match k.as_ref() {
        Some(kernel) => {
            let apps = kernel.engine.list_apps();
            serde_json::to_string(&apps).unwrap_or_default()
        }
        None => "[]".to_string(),
    }
}

/// Run an installed Trymon app
#[wasm_bindgen]
pub fn kernel_trymon_run_app(app_id: &str) -> std::result::Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    // Check if app exists and get its info
    let apps = kernel.engine.list_apps();
    if let Some(app) = apps.iter().find(|a| a.id == app_id) {
        // Check execution mode
        if app.exec_mode == crate::trymon_engine::ExecMode::Install {
            // Use TVM execution for installed TVM apps
            let result = kernel
                .engine
                .run_tvm_app(&mut kernel.processes, &mut kernel.vfs, app_id)
                .map_err(JsValue::from)?;
            return Ok(serde_json::to_string(&result).unwrap_or_default());
        }
    }

    // Fallback to legacy execution
    kernel
        .engine
        .run_app(&mut kernel.processes, &mut kernel.vfs, app_id)
        .map(|info| serde_json::to_string(&info).unwrap_or_default())
        .map_err(JsValue::from)
}

/// Export the current VFS state as a JSON string
#[wasm_bindgen]
pub fn kernel_export_vfs() -> std::result::Result<String, JsValue> {
    let k = KERNEL.lock();
    let kernel = k
        .as_ref()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    serde_json::to_string(&kernel.vfs)
        .map_err(|e| JsValue::from_str(&format!("Failed to export VFS: {}", e)))
}

/// Import a VFS state from a JSON string
#[wasm_bindgen]
pub fn kernel_import_vfs(json: &str) -> std::result::Result<(), JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    let vfs: VirtualFileSystem = serde_json::from_str(json)
        .map_err(|e| JsValue::from_str(&format!("Failed to import VFS: {}", e)))?;

    kernel.vfs = vfs;
    Ok(())
}

// ============================================================
// TVM (Trymon Virtual Machine) API
// ============================================================

use crate::tvm::interpreter::{tvm_execute_json, tvm_init as tvm_initialize, tvm_load_package};

/// Initialize the TVM subsystem
#[wasm_bindgen]
pub fn tvm_init() -> std::result::Result<(), JsValue> {
    tvm_initialize().map_err(JsValue::from)
}

/// Load a TVM bytecode package (.trymon format v2)
#[wasm_bindgen]
pub fn tvm_load(data: &[u8]) -> std::result::Result<String, JsValue> {
    log::info!("[TVM] Loading TVM package: {} bytes", data.len());

    // Validate magic bytes
    if data.len() < 4 || &data[0..4] != b"TRYM" {
        let err = "Invalid .trymon file: missing TRYM magic header".to_string();
        log::error!("[TVM] {}", err);
        return Err(JsValue::from(err));
    }

    let version = data[4];
    log::info!("[TVM] Package version: {}", version);

    tvm_load_package(data).map_err(|e| {
        log::error!("[TVM] Failed to load package: {}", e);
        JsValue::from(format!("TVM load failed: {}", e))
    })
}

/// Execute a loaded TVM package
#[wasm_bindgen]
pub fn tvm_execute(package_id: &str) -> std::result::Result<String, JsValue> {
    tvm_execute_json(package_id).map_err(JsValue::from)
}

/// Compile ELF binary to TVM bytecode
#[wasm_bindgen]
pub fn tvm_compile_elf(elf_data: &[u8], name: &str) -> std::result::Result<String, JsValue> {
    use crate::tvm::appimage_extractor::detect_appimage as check_appimage;
    use crate::tvm::bytecode::{
        PackageMetadata, TVMBytecode, TrymonEnvironment, TVM_MAGIC, TVM_VERSION,
    };
    use crate::tvm::compiler::compile_elf;

    log::info!("[TVM] Compiling ELF: {} ({} bytes)", name, elf_data.len());

    let is_appimage = check_appimage(elf_data);
    log::info!("[TVM] AppImage detected: {}", is_appimage);

    let metadata = PackageMetadata {
        name: Some(name.to_string()),
        version: Some("1.0.0".to_string()),
        entry: Some("main".to_string()),
        ..Default::default()
    };

    // Try native TVM compilation first
    let result = compile_elf(elf_data, metadata);

    if result.success {
        let bytecode = result.bytecode.unwrap();
        log::info!(
            "[TVM] Native compilation successful: {} ({} bytes bytecode)",
            name,
            result.size
        );
        let mut interp = crate::tvm::interpreter::INTERPRETER.lock();
        let id = interp
            .load_package(name, bytecode)
            .map_err(|e| JsValue::from(format!("Failed to load TVM package: {}", e)))?;
        log::info!("[TVM] Package loaded with ID: {}", id);
        return Ok(id);
    }

    // Native compilation failed - use TrymonEnvironment wrapper
    let error_msg = result.error.unwrap_or_else(|| "Unknown error".to_string());
    log::warn!(
        "[TVM] Native compilation failed: {} - using TrymonEnvironment wrapper",
        error_msg
    );

    // Extract entry point from ELF
    let entry_offset = if elf_data.len() >= 32 {
        if elf_data[4] == 2 {
            u64::from_le_bytes(elf_data[24..32].try_into().unwrap())
        } else {
            u32::from_le_bytes(elf_data[24..28].try_into().unwrap()) as u64
        }
    } else {
        0
    };

    // Create TrymonEnvironment with embedded ELF
    let env = TrymonEnvironment::new(elf_data.to_vec(), entry_offset, is_appimage);

    // Store embedded ELF data reference for v86 to access
    let mut interp = crate::tvm::interpreter::INTERPRETER.lock();

    // Use the wrapper bytecode from environment
    let id = interp.load_package(name, env.bytecode).map_err(|e| {
        log::error!("[TVM] Failed to load TrymonEnvironment: {}", e);
        JsValue::from(format!("Failed to load TrymonEnvironment: {}", e))
    })?;

    log::info!(
        "[TVM] TrymonEnvironment loaded with ID: {} (embedded ELF: {} bytes)",
        id,
        env.embedded_elf.len()
    );
    Ok(id)
}

/// Get TVM sandbox status
#[wasm_bindgen]
pub fn tvm_sandbox_status() -> String {
    crate::tvm::sandbox::sandbox_status()
}

/// Check if TVM is initialized
#[wasm_bindgen]
pub fn tvm_is_initialized() -> bool {
    crate::tvm::interpreter::tvm_is_initialized()
}

/// Export a loaded TVM package as .trymon binary data (returns base64)
#[wasm_bindgen]
pub fn tvm_export_package(package_id: &str) -> std::result::Result<Vec<u8>, JsValue> {
    use crate::tvm::bytecode::{TVMBytecode, TVM_MAGIC, TVM_VERSION};

    let interp = crate::tvm::interpreter::INTERPRETER.lock();
    let bytecode = interp
        .get_package(package_id)
        .ok_or_else(|| JsValue::from_str("Package not found"))?;

    // Serialize bytecode to .trymon v2 format
    // Format: TRYM (magic) + version(1) + flags(2) + meta_len(4) + meta_json + code_len(4) + code
    let meta = serde_json::json!({
        "name": "exported_package",
        "version": "1.0.0",
        "entry": "main",
        "description": "Exported TVM bytecode"
    });
    let meta_str = meta.to_string();
    let meta_bytes = meta_str.as_bytes();

    let code_bytes = &bytecode.instructions;

    // Calculate total size
    let total_size = 4 + 1 + 2 + 4 + meta_bytes.len() + 4 + code_bytes.len();
    let mut output = Vec::with_capacity(total_size);

    // Magic "TRYM"
    output.extend_from_slice(b"TRYM");
    // Version 2
    output.push(2u8);
    // Flags (u16 LE)
    output.extend_from_slice(&bytecode.flags.to_le_bytes());
    // Meta length (u32 LE)
    let meta_len = meta_bytes.len() as u32;
    output.extend_from_slice(&meta_len.to_le_bytes());
    // Meta bytes
    output.extend_from_slice(meta_bytes);
    // Code length (u32 LE)
    let code_len = code_bytes.len() as u32;
    output.extend_from_slice(&code_len.to_le_bytes());
    // Code bytes
    output.extend_from_slice(code_bytes);

    Ok(output)
}

/// Execute a .trymon package directly (Execute mode)
#[wasm_bindgen]
pub fn trymon_execute_package(binary_id: &str) -> std::result::Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    use crate::trymon_engine::ExecMode;

    // Check if app already exists and is executable mode
    let apps = kernel.engine.list_apps();
    if let Some(app) = apps
        .iter()
        .find(|a| a.name == binary_id && a.exec_mode == ExecMode::Execute)
    {
        // Already loaded as executable - execute it
        let result = kernel
            .engine
            .run_tvm_app(&mut kernel.processes, &mut kernel.vfs, &app.id)
            .map_err(JsValue::from)?;
        return Ok(serde_json::to_string(&result).unwrap_or_default());
    }

    // Load and execute fresh
    let result = kernel
        .engine
        .execute_package(&mut kernel.vfs, &kernel.loader, binary_id)
        .map_err(JsValue::from)?;

    Ok(serde_json::to_string(&result).unwrap_or_default())
}

/// Install a TVM bytecode package (Install mode)
#[wasm_bindgen]
pub fn trymon_install_tvm(package_id: &str, name: &str) -> std::result::Result<String, JsValue> {
    let mut k = KERNEL.lock();
    let kernel = k
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Kernel not initialized"))?;

    let app_info = kernel
        .engine
        .install_tvm_package(&mut kernel.vfs, package_id, name)
        .map_err(JsValue::from)?;

    Ok(serde_json::to_string(&app_info).unwrap_or_default())
}
