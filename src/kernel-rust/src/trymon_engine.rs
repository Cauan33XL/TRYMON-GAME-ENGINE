//! Trymon Execution Engine
//! 
//! Dedicated subsystem for managing and executing .trymon packages.
//! Handles installation, lifecycle, and app-specific environment.

use std::collections::HashMap;
use uuid::Uuid;
use serde::{Serialize, Deserialize};
use crate::error::{Result, KernelError};
use crate::binary_loader::{BinaryLoader, BinaryFormat};
use crate::virtual_fs::VirtualFileSystem;
use crate::process_manager::{ProcessManager, ProcessInfo};

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
        
        self.initialized = true;
        log::info!("TrymonEngine ready");
        Ok(())
    }

    /// Install a .trymon package into the system
    pub fn install_package(&mut self, vfs: &mut VirtualFileSystem, loader: &BinaryLoader, binary_id: &str) -> Result<AppInfo> {
        if !self.initialized {
            return Err(KernelError::ExecutionError("TrymonEngine not initialized".into()));
        }

        let binary = loader.get_binary_info(binary_id)
            .ok_or_else(|| KernelError::InvalidBinary(binary_id.to_string()))?;

        if binary.format != BinaryFormat::Trymon {
            return Err(KernelError::UnsupportedFormat("Only .trymon packages can be installed via TrymonEngine".into()));
        }

        let metadata = binary.metadata.as_ref()
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
            if let Some(mut file) = vfs.get_file_mut(&exe_path) {
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
        };

        self.apps.insert(app_id, app_info.clone());
        log::info!("App installed successfully: {} (ID: {})", app_info.name, app_info.id);
        
        Ok(app_info)
    }

    /// List all installed apps
    pub fn list_apps(&self) -> Vec<AppInfo> {
        self.apps.values().cloned().collect()
    }

    /// Run an installed app
    pub fn run_app(
        &mut self, 
        processes: &mut ProcessManager, 
        vfs: &mut VirtualFileSystem,
        app_id: &str
    ) -> Result<ProcessInfo> {
        let app = self.apps.get_mut(app_id)
            .ok_or_else(|| KernelError::ExecutionError(format!("App with ID {} not found", app_id)))?;

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
