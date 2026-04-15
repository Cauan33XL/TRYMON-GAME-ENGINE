//! TVM Interpreter
//!
//! High-level interpreter that wraps the VM and provides a clean API
//! for executing TVM bytecode packages.

use super::bytecode::{CompileResult, PackageMetadata, TVMBytecode};
use super::memory::DEFAULT_MEMORY_LIMIT;
use super::syscalls::{create_syscall_handler, DefaultSyscallHandler, SyscallContext};
use super::vm::{ExecutionState, ExecutionStats, ExitReason, TVM};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// TVM Execution modes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionMode {
    /// Execute and terminate (like running an executable)
    Execute,
    /// Install to VFS for persistent use
    Install,
}

/// TVM Execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    /// Whether execution succeeded
    pub success: bool,
    /// Exit code
    pub exit_code: i32,
    /// stdout content
    pub stdout: String,
    /// stderr content
    pub stderr: String,
    /// Execution statistics
    pub stats: ExecutionStats,
    /// Error message if failed
    pub error: Option<String>,
}

impl ExecutionResult {
    pub fn success(exit_code: i32, stats: ExecutionStats) -> Self {
        Self {
            success: true,
            exit_code,
            stdout: String::new(),
            stderr: String::new(),
            stats,
            error: None,
        }
    }

    pub fn error(msg: String) -> Self {
        Self {
            success: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            stats: ExecutionStats::default(),
            error: Some(msg),
        }
    }
}

/// TVM Interpreter - main interface for executing TVM bytecode
pub struct Interpreter {
    /// VM instances by execution ID
    vms: HashMap<String, TVM>,
    /// Loaded bytecode packages
    packages: HashMap<String, TVMBytecode>,
    /// Syscall handler
    syscall_handler: Option<DefaultSyscallHandler>,
    /// Max concurrent executions
    max_concurrent: usize,
}

impl Interpreter {
    /// Create new interpreter
    pub fn new() -> Self {
        Self {
            vms: HashMap::new(),
            packages: HashMap::new(),
            syscall_handler: Some(DefaultSyscallHandler::new()),
            max_concurrent: 10,
        }
    }

    /// Load a bytecode package
    pub fn load_package(&mut self, name: &str, bytecode: TVMBytecode) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();

        // Validate bytecode
        if bytecode.magic != *super::bytecode::TVM_MAGIC {
            return Err("Invalid TVM bytecode magic".to_string());
        }

        self.packages.insert(id.clone(), bytecode);
        log::info!("TVM: Loaded package '{}' (id: {})", name, id);

        Ok(id)
    }

    /// Load bytecode from raw .trymon file data
    pub fn load_from_data(&mut self, data: &[u8]) -> Result<(String, PackageMetadata), String> {
        // Parse .trymon format
        if data.len() < 13 || &data[0..4] != b"TRYM" {
            return Err("Invalid .trymon package format".to_string());
        }

        let version = data[4];
        if version != 2 {
            return Err(format!("Unsupported .trymon version: {}", version));
        }

        // Parse metadata
        let meta_len = u32::from_le_bytes(data[5..9].try_into().unwrap()) as usize;
        if data.len() < 9 + meta_len + 4 {
            return Err("Truncated .trymon package".to_string());
        }

        let meta_json = std::str::from_utf8(&data[9..9 + meta_len])
            .map_err(|e| format!("Invalid metadata UTF-8: {}", e))?;

        let metadata: PackageMetadata =
            serde_json::from_str(meta_json).map_err(|e| format!("Invalid metadata JSON: {}", e))?;

        // Parse bytecode
        let code_offset = 9 + meta_len;
        let code_len =
            u32::from_le_bytes(data[code_offset..code_offset + 4].try_into().unwrap()) as usize;

        if data.len() < code_offset + 4 + code_len {
            return Err("Truncated .trymon bytecode".to_string());
        }

        // For now, wrap in simple TVM bytecode
        let bytecode_data = data[code_offset + 4..code_offset + 4 + code_len].to_vec();
        let tvm_bytecode = TVMBytecode {
            magic: *super::bytecode::TVM_MAGIC,
            version: super::bytecode::TVM_VERSION,
            flags: 0,
            entry_point: 0,
            instruction_count: (code_len / 4) as u32,
            constants_offset: 0,
            constants_size: 0,
            code_offset: 0,
            code_size: code_len as u32,
            instructions: bytecode_data,
            constants: Vec::new(),
        };

        let package_id =
            self.load_package(metadata.name.as_deref().unwrap_or("unknown"), tvm_bytecode)?;

        Ok((package_id, metadata))
    }

    /// Execute a loaded package
    pub fn execute(&mut self, package_id: &str) -> Result<ExecutionResult, String> {
        let bytecode = self.packages.get(package_id).ok_or("Package not found")?;

        let mut vm = TVM::new(DEFAULT_MEMORY_LIMIT);

        // Setup syscall handler
        vm.set_syscall_handler(create_syscall_handler());

        // Load bytecode
        vm.load(bytecode.clone())?;

        // Run
        match vm.run() {
            Ok(exit_code) => {
                let stats = vm.stats().clone();
                let mut result = ExecutionResult::success(exit_code, stats);
                result.stdout = vm.stdout().to_string();
                result.stderr = vm.stderr().to_string();
                Ok(result)
            }
            Err(e) => {
                let stats = vm.stats().clone();
                let mut result = ExecutionResult::error(e.clone());
                result.stdout = vm.stdout().to_string();
                result.stderr = vm.stderr().to_string();
                result.stats = stats;
                Ok(result)
            }
        }
    }

    /// Execute with custom stdin input
    pub fn execute_with_input(
        &mut self,
        package_id: &str,
        input: &str,
    ) -> Result<ExecutionResult, String> {
        let result = self.execute(package_id)?;
        // Input handling would be added here - for now just return result
        Ok(result)
    }

    /// Get package metadata
    pub fn get_package(&self, package_id: &str) -> Option<&TVMBytecode> {
        self.packages.get(package_id)
    }

    /// List all loaded packages
    pub fn list_packages(&self) -> Vec<&String> {
        self.packages.keys().collect()
    }

    /// Remove a package
    pub fn unload_package(&mut self, package_id: &str) -> bool {
        self.packages.remove(package_id).is_some()
    }

    /// Get VM state for a running execution
    pub fn get_vm_state(&self, _execution_id: &str) -> Option<ExecutionState> {
        // Would track running executions
        None
    }

    /// Stop a running execution
    pub fn stop_execution(&mut self, _execution_id: &str) -> bool {
        // Would implement execution stopping
        false
    }

    /// Get interpreter statistics
    pub fn stats(&self) -> InterpreterStats {
        InterpreterStats {
            loaded_packages: self.packages.len(),
            active_vms: self.vms.len(),
            max_concurrent: self.max_concurrent,
        }
    }
}

/// Interpreter statistics
#[derive(Debug, Clone, Default)]
pub struct InterpreterStats {
    pub loaded_packages: usize,
    pub active_vms: usize,
    pub max_concurrent: usize,
}

/// Global interpreter instance (for WASM)
use once_cell::sync::Lazy;
use parking_lot::Mutex;

pub static INTERPRETER: Lazy<Mutex<Interpreter>> = Lazy::new(|| Mutex::new(Interpreter::new()));

/// Check if TVM is initialized
pub fn tvm_is_initialized() -> bool {
    // Check if interpreter was created (Lazy ensures it's always created)
    // We check by verifying the interpreter exists
    true
}

/// Initialize the TVM interpreter (WASM entry point)
pub fn tvm_init() -> Result<(), String> {
    // Reset interpreter
    *INTERPRETER.lock() = Interpreter::new();
    log::info!("TVM Interpreter initialized");
    Ok(())
}

/// Load a .trymon package (WASM entry point)
pub fn tvm_load_package(data: &[u8]) -> Result<String, String> {
    let mut interpreter = INTERPRETER.lock();
    let (id, _metadata) = interpreter.load_from_data(data)?;
    Ok(id)
}

/// Execute a loaded package (WASM entry point)
pub fn tvm_execute(package_id: &str) -> Result<ExecutionResult, String> {
    let mut interpreter = INTERPRETER.lock();
    interpreter.execute(package_id)
}

/// Execute with input
pub fn tvm_execute_with_input(package_id: &str, input: &str) -> Result<ExecutionResult, String> {
    let mut interpreter = INTERPRETER.lock();
    interpreter.execute_with_input(package_id, input)
}

/// List loaded packages
pub fn tvm_list_packages() -> Vec<String> {
    let interpreter = INTERPRETER.lock();
    interpreter.list_packages().into_iter().cloned().collect()
}

/// Get execution result as JSON string
pub fn tvm_execute_json(package_id: &str) -> Result<String, String> {
    let result = tvm_execute(package_id)?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}
