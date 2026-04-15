//! Trymon Execution Engine
//!
//! Dedicated subsystem for managing and executing .trymon packages.
//! Handles installation, lifecycle, and app-specific environment.

use crate::binary_loader::{BinaryFormat, BinaryLoader};
use crate::error::{KernelError, Result};
use crate::process_manager::{ProcessInfo, ProcessManager};
use crate::tvm::interpreter::{ExecutionResult, INTERPRETER};
use crate::virtual_fs::VirtualFileSystem;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Trymon Application Information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    /// Unique application ID
    pub id: String,
    /// Application name
    pub name: String,
    /// Application version
    pub version: String,
    /// Author / Maintainer
    pub author: Option<String>,
    /// Description
    pub description: Option<String>,
    /// Icon data (Base64)
    pub icon: Option<String>,
    /// Installation path in VFS
    pub install_path: String,
    /// Executable entry point relative to install_path
    pub entry_point: String,
    /// Current application status
    pub status: AppStatus,
    /// Execution mode
    pub exec_mode: ExecMode,
}

/// Execution mode for .trymon packages
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecMode {
    /// Execute and terminate (run directly)
    Execute,
    /// Install to VFS for persistent use
    Install,
}

/// Application Lifecycle Status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppStatus {
    /// App is installed and ready
    Installed,
    /// App is currently running
    Running,
    /// App was running but is now stopped
    Stopped,
    /// Error state
    Error,
}

/// Trymon Execution Engine Subsystem
pub struct TrymonEngine {
    /// Registry of installed apps (id -> AppInfo)
    apps: HashMap<String, AppInfo>,
    /// Whether initialized
    initialized: bool,
}

impl TrymonEngine {
    /// Create a new Trymon Engine
    pub fn new() -> Self {
        Self {
            apps: HashMap::new(),
            initialized: false,
        }
    }

    /// Initialize the engine and ensure base directory exists
    pub fn init(&mut self, vfs: &mut VirtualFileSystem) -> Result<()> {
        log::info!("TrymonEngine initializing...");

        // Ensure /apps directory exists
        if vfs.get_file("/apps").is_none() {
            vfs.create_directory("/apps")?;
        }

        // Ensure /trymon directory exists for TVM packages
        if vfs.get_file("/trymon").is_none() {
            vfs.create_directory("/trymon")?;
        }

        self.initialized = true;
        log::info!("TrymonEngine ready");
        Ok(())
    }

    /// Install a .trymon package into the system
    pub fn install_package(
        &mut self,
        vfs: &mut VirtualFileSystem,
        loader: &BinaryLoader,
        binary_id: &str,
    ) -> Result<AppInfo> {
        if !self.initialized {
            return Err(KernelError::ExecutionError(
                "TrymonEngine not initialized".into(),
            ));
        }

        let binary = loader
            .get_binary_info(binary_id)
            .ok_or_else(|| KernelError::InvalidBinary(binary_id.to_string()))?;

        if binary.format != BinaryFormat::Trymon {
            return Err(KernelError::UnsupportedFormat(
                "Only .trymon packages can be installed via TrymonEngine".into(),
            ));
        }

        let metadata = binary
            .metadata
            .as_ref()
            .ok_or_else(|| KernelError::ParseError("Missing metadata in .trymon package".into()))?;

        log::info!("Installing Trymon package: {}", binary.name);

        let app_id = Uuid::new_v4().to_string();
        let install_path = format!("/apps/{}", app_id);

        // Create app directory
        vfs.create_directory(&install_path)?;

        // Extract binary data to its install path
        if let Some(binary_data) = loader.get_binary(binary_id) {
            let exe_name = metadata.name.clone().unwrap_or_else(|| "main".into());
            let exe_path = format!("{}/{}", install_path, exe_name);

            vfs.extract_binary(&exe_path, &binary_data.data)?;

            // Mark as executable
            if let Some(file) = vfs.get_file_mut(&exe_path) {
                file.executable = true;
                file.permissions = 0o755;
            }
        }

        let app_info = AppInfo {
            id: app_id.clone(),
            name: metadata.name.clone().unwrap_or_else(|| binary.name.clone()),
            version: metadata.version.clone().unwrap_or_else(|| "1.0.0".into()),
            author: metadata.maintainer.clone(),
            description: metadata.description.clone(),
            icon: metadata.icon.clone(),
            install_path,
            entry_point: metadata.entry.clone().unwrap_or_else(|| "main".into()),
            status: AppStatus::Installed,
            exec_mode: ExecMode::Install,
        };

        self.apps.insert(app_id, app_info.clone());
        log::info!(
            "App installed successfully: {} (ID: {})",
            app_info.name,
            app_info.id
        );

        Ok(app_info)
    }

    /// Execute a .trymon package directly (without installation)
    pub fn execute_package(
        &mut self,
        vfs: &mut VirtualFileSystem,
        loader: &BinaryLoader,
        binary_id: &str,
    ) -> Result<ExecutionResult> {
        if !self.initialized {
            return Err(KernelError::ExecutionError(
                "TrymonEngine not initialized".into(),
            ));
        }

        let binary = loader
            .get_binary_info(binary_id)
            .ok_or_else(|| KernelError::InvalidBinary(binary_id.to_string()))?;

        if binary.format != BinaryFormat::Trymon {
            return Err(KernelError::UnsupportedFormat(
                "Only .trymon packages can be executed via TrymonEngine".into(),
            ));
        }

        let binary_data = loader
            .get_binary(binary_id)
            .ok_or_else(|| KernelError::InvalidBinary(binary_id.to_string()))?;

        // Load into TVM interpreter
        let mut interpreter = INTERPRETER.lock();
        let (package_id, _metadata) = interpreter
            .load_from_data(&binary_data.data)
            .map_err(|e| KernelError::ExecutionError(e))?;

        // Execute
        let result = interpreter
            .execute(&package_id)
            .map_err(|e| KernelError::ExecutionError(e))?;

        log::info!(
            "TVM Execution completed: {} (exit code: {})",
            binary.name,
            result.exit_code
        );

        Ok(result)
    }

    /// Install a TVM bytecode package to VFS
    pub fn install_tvm_package(
        &mut self,
        vfs: &mut VirtualFileSystem,
        package_id: &str,
        name: &str,
    ) -> Result<AppInfo> {
        if !self.initialized {
            return Err(KernelError::ExecutionError(
                "TrymonEngine not initialized".into(),
            ));
        }

        let interpreter = INTERPRETER.lock();
        let bytecode = interpreter
            .get_package(package_id)
            .ok_or_else(|| KernelError::InvalidBinary(package_id.to_string()))?;

        let app_id = Uuid::new_v4().to_string();
        let install_path = format!("/trymon/{}", app_id);

        // Create directory
        vfs.create_directory(&install_path)?;

        // Store bytecode in VFS
        let bytecode_path = format!("{}/main.tvm", install_path);
        vfs.extract_binary(&bytecode_path, &bytecode.instructions)?;

        // Mark as executable
        if let Some(file) = vfs.get_file_mut(&bytecode_path) {
            file.executable = true;
            file.permissions = 0o755;
        }

        let app_info = AppInfo {
            id: app_id.clone(),
            name: name.to_string(),
            version: "1.0.0".to_string(),
            author: None,
            description: Some("TVM bytecode application".to_string()),
            icon: None,
            install_path,
            entry_point: "main.tvm".to_string(),
            status: AppStatus::Installed,
            exec_mode: ExecMode::Install,
        };

        self.apps.insert(app_id.clone(), app_info.clone());
        log::info!("TVM App installed: {} (ID: {})", name, app_id);

        Ok(app_info)
    }

    /// Execute a TVM app from VFS
    pub fn run_tvm_app(
        &mut self,
        _processes: &mut ProcessManager,
        vfs: &mut VirtualFileSystem,
        app_id: &str,
    ) -> Result<ExecutionResult> {
        let app = self.apps.get_mut(app_id).ok_or_else(|| {
            KernelError::ExecutionError(format!("App with ID {} not found", app_id))
        })?;

        // Read bytecode from VFS
        let exe_path = format!("{}/{}", app.install_path, app.entry_point);
        let file = vfs.get_file(&exe_path).ok_or_else(|| {
            KernelError::FileSystemError(format!("App bytecode not found: {}", exe_path))
        })?;

        let bytecode_data = file
            .content
            .as_ref()
            .ok_or_else(|| KernelError::FileSystemError("File has no content".to_string()))?;

        // Load into TVM
        let mut interpreter = INTERPRETER.lock();
        let (package_id, _metadata) = interpreter
            .load_from_data(bytecode_data)
            .map_err(|e| KernelError::ExecutionError(e))?;

        // Execute
        let result = interpreter
            .execute(&package_id)
            .map_err(|e| KernelError::ExecutionError(e))?;

        app.status = AppStatus::Running;

        Ok(result)
    }

    /// List all installed apps
    pub fn list_apps(&self) -> Vec<AppInfo> {
        self.apps.values().cloned().collect()
    }

    /// Run an installed app (legacy mode - uses VFS binary execution)
    pub fn run_app(
        &mut self,
        processes: &mut ProcessManager,
        vfs: &mut VirtualFileSystem,
        app_id: &str,
    ) -> Result<ProcessInfo> {
        let app = self.apps.get_mut(app_id).ok_or_else(|| {
            KernelError::ExecutionError(format!("App with ID {} not found", app_id))
        })?;

        log::info!("Running Trymon App: {} ({})", app.name, app.id);

        let exe_path = format!("{}/{}", app.install_path, app.entry_point);

        // Setup specialized environment
        let mut env = HashMap::new();
        env.insert("TRYMON_APP_ID".into(), app.id.clone());
        env.insert("TRYMON_APP_PATH".into(), app.install_path.clone());
        env.insert("HOME".into(), app.install_path.clone());

        // Execute via ProcessManager using the VFS path
        let process_info = processes.execute_vfs_binary(vfs, &exe_path, &app.name, env)?;

        app.status = AppStatus::Running;

        Ok(process_info)
    }
}
