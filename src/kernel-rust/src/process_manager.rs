//! Process Manager Module
//! 
//! Handles execution, monitoring, and management of binary processes.
//! Simulates process forking, execution, and signal handling in WASM.

use std::collections::HashMap;
use chrono::Utc;
use serde::{Serialize, Deserialize};
use crate::error::{Result, KernelError};
use crate::binary_loader::{BinaryLoader, BinaryInfo};
use crate::virtual_fs::VirtualFileSystem;

/// Process state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessState {
    /// Process is starting
    Starting,
    /// Process is running
    Running,
    /// Process is stopped
    Stopped,
    /// Process has exited
    Exited(i32),
    /// Process crashed
    Crashed(i32),
}

/// Process information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    /// Process ID (UUID)
    pub pid: String,
    /// Process name
    pub name: String,
    /// Binary ID that was executed
    pub binary_id: String,
    /// Current state
    pub state: ProcessState,
    /// Exit code (if exited)
    pub exit_code: Option<i32>,
    /// Parent process ID
    pub ppid: Option<String>,
    /// Child processes
    pub children: Vec<String>,
    /// Memory usage (bytes)
    pub memory_usage: u64,
    /// CPU usage percentage
    pub cpu_usage: f64,
    /// Start time (Unix timestamp)
    pub start_time: i64,
    /// End time (Unix timestamp)
    pub end_time: Option<i64>,
    /// Working directory
    pub cwd: String,
    /// Environment variables
    pub env: HashMap<String, String>,
    /// Command line arguments
    pub argv: Vec<String>,
    /// Standard output buffer
    pub stdout: String,
    /// Standard error buffer
    pub stderr: String,
    /// Standard input buffer
    pub stdin_pending: String,
}

/// Process Manager subsystem
pub struct ProcessManager {
    /// All processes (pid -> ProcessInfo)
    processes: HashMap<String, ProcessInfo>,
    /// Maximum allowed processes
    max_processes: u32,
    /// Whether initialized
    initialized: bool,
    /// Process counter for PIDs
    process_counter: u32,
}

impl ProcessManager {
    /// Create a new process manager
    pub fn new(max_processes: u32) -> Self {
        Self {
            processes: HashMap::new(),
            max_processes,
            initialized: false,
            process_counter: 1, // PID 1 is init
        }
    }

    /// Initialize the process manager
    pub fn init(&mut self) -> Result<()> {
        log::info!("ProcessManager initializing...");

        // Create init process (PID 1)
        let init_pid = "1".to_string();
        let now = Utc::now().timestamp();
        
        let init = ProcessInfo {
            pid: init_pid.clone(),
            name: "init".to_string(),
            binary_id: String::new(),
            state: ProcessState::Running,
            exit_code: None,
            ppid: None,
            children: Vec::new(),
            memory_usage: 1024 * 1024, // 1 MB
            cpu_usage: 0.1,
            start_time: now,
            end_time: None,
            cwd: "/".to_string(),
            env: {
                let mut env = HashMap::new();
                env.insert("PATH".to_string(), "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string());
                env.insert("HOME".to_string(), "/root".to_string());
                env.insert("TERM".to_string(), "xterm-256color".to_string());
                env.insert("SHELL".to_string(), "/bin/bash".to_string());
                env
            },
            argv: vec!["/sbin/init".to_string()],
            stdout: String::new(),
            stderr: String::new(),
            stdin_pending: String::new(),
        };

        self.processes.insert(init_pid, init);
        self.initialized = true;
        
        log::info!("ProcessManager ready (init process created)");
        Ok(())
    }

    /// Execute a loaded binary
    pub fn execute_binary(
        &mut self,
        loader: &BinaryLoader,
        vfs: &mut VirtualFileSystem,
        binary_id: &str
    ) -> Result<ProcessInfo> {
        if !self.initialized {
            return Err(KernelError::ExecutionError("ProcessManager not initialized".into()));
        }

        // Check process limit
        let running_count = self.running_count();
        if running_count >= self.max_processes as usize {
            return Err(KernelError::ExecutionError(
                format!("Maximum process limit reached ({})", self.max_processes)
            ));
        }

        // Get binary info
        let binary = loader.get_binary_info(binary_id)
            .ok_or_else(|| KernelError::InvalidBinary(binary_id.to_string()))?;

        log::info!("Executing binary: {} (id: {})", binary.name, binary_id);

        // Create process
        let pid = format!("{}", self.process_counter);
        self.process_counter += 1;

        let now = Utc::now().timestamp();
        let cwd = vfs.cwd().to_string();

        let process = ProcessInfo {
            pid: pid.clone(),
            name: binary.name.clone(),
            binary_id: binary_id.to_string(),
            state: ProcessState::Starting,
            exit_code: None,
            ppid: Some("1".to_string()), // Parent is init
            children: Vec::new(),
            memory_usage: 0,
            cpu_usage: 0.0,
            start_time: now,
            end_time: None,
            cwd,
            env: self.get_default_env(&binary),
            argv: vec![format!("/mnt/binary/{}", binary.name)],
            stdout: format!("Starting {}...\n", binary.name),
            stderr: String::new(),
            stdin_pending: String::new(),
        };

        // Extract binary to filesystem
        if let Some(binary_data) = loader.get_binary(binary_id) {
            let extract_path = format!("/mnt/binary/{}", binary.name);
            vfs.extract_binary(&extract_path, &binary_data.data)?;
            
            // Make executable
            if let Some(file) = vfs.get_file(&extract_path) {
                let mut updated = file.clone();
                updated.executable = true;
                updated.permissions = 0o755;
                // Note: would need to update in vfs, simplified here
            }
        }

        // Add to init's children
        if let Some(init) = self.processes.get_mut("1") {
            init.children.push(pid.clone());
        }

        // Mark as running
        let mut final_process = process;
        final_process.state = ProcessState::Running;
        
        // Simulate initial resource usage
        final_process.memory_usage = (binary.size as u64).min(50 * 1024 * 1024); // Cap at 50MB
        final_process.cpu_usage = 2.5;

        self.processes.insert(pid.clone(), final_process.clone());

        log::info!("Process started: {} (PID: {})", binary.name, pid);
        Ok(final_process)
    }

    /// Stop a running process
    pub fn stop_process(&mut self, pid: &str) -> Result<()> {
        let process = self.processes.get_mut(pid)
            .ok_or_else(|| KernelError::ProcessNotFound(pid.to_string()))?;

        match process.state {
            ProcessState::Running | ProcessState::Starting => {
                process.state = ProcessState::Exited(0);
                process.exit_code = Some(0);
                process.end_time = Some(Utc::now().timestamp());
                process.stdout.push_str("\nProcess terminated.\n");
                
                log::info!("Process stopped: {} (PID: {})", process.name, pid);
                Ok(())
            }
            _ => Err(KernelError::ProcessNotFound(pid.to_string())),
        }
    }

    /// Send input to a process
    pub fn send_input(&mut self, pid: &str, input: &str) -> Result<()> {
        let process = self.processes.get_mut(pid)
            .ok_or_else(|| KernelError::ProcessNotFound(pid.to_string()))?;

        if process.state != ProcessState::Running {
            return Err(KernelError::ExecutionError("Process not running".into()));
        }

        process.stdin_pending.push_str(input);
        
        // Simulate echo for now
        process.stdout.push_str(input);
        
        Ok(())
    }

    /// Get process output
    pub fn get_output(&self, pid: &str) -> Option<String> {
        self.processes.get(pid).map(|p| p.stdout.clone())
    }

    /// Get process info
    pub fn get_process(&self, pid: &str) -> Option<&ProcessInfo> {
        self.processes.get(pid)
    }

    /// List all processes
    pub fn list_processes(&self) -> Vec<ProcessInfo> {
        self.processes.values().cloned().collect()
    }

    /// Get count of running processes
    pub fn running_count(&self) -> usize {
        self.processes.values()
            .filter(|p| p.state == ProcessState::Running || p.state == ProcessState::Starting)
            .count()
    }

    /// Get total memory usage by all processes
    pub fn memory_usage(&self) -> u64 {
        self.processes.values()
            .filter(|p| p.state == ProcessState::Running)
            .map(|p| p.memory_usage)
            .sum()
    }

    /// Simulate process execution tick (call periodically)
    pub fn tick(&mut self) {
        for process in self.processes.values_mut() {
            if process.state == ProcessState::Running {
                // Simulate CPU and memory fluctuations
                use std::time::SystemTime;
                let seed = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                
                let variation = ((seed % 100) as f64) / 100.0;
                process.cpu_usage = (process.cpu_usage + variation - 0.5).max(0.1).min(95.0);
                process.memory_usage = (process.memory_usage as f64 * (1.0 + variation * 0.01 - 0.005)) as u64;
                
                // Process stdin if any
                if !process.stdin_pending.is_empty() {
                    let input = process.stdin_pending.clone();
                    process.stdin_pending.clear();
                    // Echo input back (simulated shell)
                    process.stdout.push_str(&input);
                }
            }
        }
    }

    // ============================================================
    // Helper functions
    // ============================================================

    /// Get default environment for a binary
    fn get_default_env(&self, binary: &BinaryInfo) -> HashMap<String, String> {
        let mut env = HashMap::new();
        
        // Standard Linux environment
        env.insert("PATH".to_string(), "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string());
        env.insert("HOME".to_string(), "/root".to_string());
        env.insert("TERM".to_string(), "xterm-256color".to_string());
        env.insert("SHELL".to_string(), "/bin/bash".to_string());
        env.insert("USER".to_string(), "root".to_string());
        env.insert("LANG".to_string(), "C.UTF-8".to_string());
        env.insert("LD_LIBRARY_PATH".to_string(), "/usr/lib:/usr/local/lib".to_string());
        
        // Binary-specific
        env.insert("TRMON_BINARY".to_string(), binary.name.clone());
        env.insert("TRMON_BINARY_ID".to_string(), binary.id.clone());
        env.insert("TRMON_SANDBOX".to_string(), "1".to_string());
        
        env
    }
}
