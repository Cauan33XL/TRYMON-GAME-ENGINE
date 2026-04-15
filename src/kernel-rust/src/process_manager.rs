//! Process Manager Module
//!
//! Handles execution, monitoring, and management of binary processes.
//! Simulates process forking, execution, and signal handling in WASM.

use crate::binary_loader::{BinaryInfo, BinaryLoader};
use crate::error::{KernelError, Result};
use crate::virtual_fs::VirtualFileSystem;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// POSIX Signals
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Signal {
    /// Hangup detected
    SIGHUP = 1,
    /// Interrupt from keyboard
    SIGINT = 2,
    /// Quit from keyboard
    SIGQUIT = 3,
    /// Illegal instruction
    SIGILL = 4,
    /// Trace/breakpoint trap
    SIGTRAP = 5,
    /// Abort
    SIGABRT = 6,
    /// Bus error
    SIGBUS = 7,
    /// Segmentation fault
    SIGSEGV = 11,
    /// Termination signal
    SIGTERM = 15,
    /// Continue process
    SIGCONT = 18,
    /// Stop process
    SIGSTOP = 19,
}

impl Signal {
    /// Convert a signal number to a Signal enum
    pub fn from_number(num: i32) -> Option<Self> {
        match num {
            1 => Some(Signal::SIGHUP),
            2 => Some(Signal::SIGINT),
            3 => Some(Signal::SIGQUIT),
            4 => Some(Signal::SIGILL),
            5 => Some(Signal::SIGTRAP),
            6 => Some(Signal::SIGABRT),
            7 => Some(Signal::SIGBUS),
            11 => Some(Signal::SIGSEGV),
            15 => Some(Signal::SIGTERM),
            18 => Some(Signal::SIGCONT),
            19 => Some(Signal::SIGSTOP),
            _ => None,
        }
    }

    /// Get the default action for a signal
    pub fn default_action(&self) -> SignalAction {
        match self {
            Signal::SIGTERM | Signal::SIGINT | Signal::SIGHUP | Signal::SIGQUIT => {
                SignalAction::Terminate
            }
            Signal::SIGSTOP => SignalAction::Stop,
            Signal::SIGCONT => SignalAction::Continue,
            _ => SignalAction::Ignore,
        }
    }
}

/// What to do when a signal is received
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignalAction {
    /// Ignore the signal
    Ignore,
    /// Terminate the process
    Terminate,
    /// Stop the process
    Stop,
    /// Continue the process
    Continue,
}

/// Pipe for inter-process communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pipe {
    /// Pipe ID
    pub id: String,
    /// Buffer
    pub buffer: Vec<u8>,
    /// Reader process PID
    pub reader_pid: Option<String>,
    /// Writer process PID
    pub writer_pid: Option<String>,
}

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
    /// Process group ID
    pub pgid: Option<String>,
    /// Pending signals
    pub pending_signals: Vec<i32>,
    /// Signal handlers (signal number -> action)
    pub signal_handlers: HashMap<i32, SignalAction>,
    /// Pipe ID if connected via pipe
    pub pipe_id: Option<String>,
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
    /// Pipes for IPC
    pipes: HashMap<String, Pipe>,
}

impl ProcessManager {
    /// Create a new process manager
    pub fn new(max_processes: u32) -> Self {
        Self {
            processes: HashMap::new(),
            max_processes,
            initialized: false,
            process_counter: 1, // PID 1 is init
            pipes: HashMap::new(),
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
                env.insert(
                    "PATH".to_string(),
                    "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
                );
                env.insert("HOME".to_string(), "/root".to_string());
                env.insert("TERM".to_string(), "xterm-256color".to_string());
                env.insert("SHELL".to_string(), "/bin/bash".to_string());
                env
            },
            argv: vec!["/sbin/init".to_string()],
            stdout: String::new(),
            stderr: String::new(),
            stdin_pending: String::new(),
            pgid: None,
            pending_signals: Vec::new(),
            signal_handlers: HashMap::new(),
            pipe_id: None,
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
        binary_id: &str,
    ) -> Result<ProcessInfo> {
        if !self.initialized {
            return Err(KernelError::ExecutionError(
                "ProcessManager not initialized".into(),
            ));
        }

        // Check process limit
        let running_count = self.running_count();
        if running_count >= self.max_processes as usize {
            return Err(KernelError::ExecutionError(format!(
                "Maximum process limit reached ({})",
                self.max_processes
            )));
        }

        // Get binary info
        let binary = loader
            .get_binary_info(binary_id)
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
            pgid: None,
            pending_signals: Vec::new(),
            signal_handlers: HashMap::new(),
            pipe_id: None,
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

    /// Execute a binary already present in the VFS
    pub fn execute_vfs_binary(
        &mut self,
        vfs: &mut VirtualFileSystem,
        path: &str,
        name: &str,
        extra_env: HashMap<String, String>,
    ) -> Result<ProcessInfo> {
        if !self.initialized {
            return Err(KernelError::ExecutionError(
                "ProcessManager not initialized".into(),
            ));
        }

        // Check process limit
        if self.running_count() >= self.max_processes as usize {
            return Err(KernelError::ExecutionError(format!(
                "Maximum process limit reached ({})",
                self.max_processes
            )));
        }

        let file = vfs.get_file(path).ok_or_else(|| {
            KernelError::FileSystemError(format!("Binary not found in VFS: {}", path))
        })?;

        if !file.executable {
            return Err(KernelError::ExecutionError(format!(
                "File is not executable: {}",
                path
            )));
        }

        let pid = format!("{}", self.process_counter);
        self.process_counter += 1;

        let now = Utc::now().timestamp();

        // Setup environment
        let mut env = self.get_base_env();
        for (k, v) in extra_env {
            env.insert(k, v);
        }

        let process = ProcessInfo {
            pid: pid.clone(),
            name: name.to_string(),
            binary_id: "vfs-execution".to_string(),
            state: ProcessState::Running,
            exit_code: None,
            ppid: Some("1".to_string()),
            children: Vec::new(),
            memory_usage: (file.size as u64).min(50 * 1024 * 1024),
            cpu_usage: 1.5,
            start_time: now,
            end_time: None,
            cwd: vfs.cwd().to_string(),
            env,
            argv: vec![path.to_string()],
            stdout: format!("Running {} from VFS...\n", name),
            stderr: String::new(),
            stdin_pending: String::new(),
            pgid: None,
            pending_signals: Vec::new(),
            signal_handlers: HashMap::new(),
            pipe_id: None,
        };

        self.processes.insert(pid.clone(), process.clone());

        // Add to init's children
        if let Some(init) = self.processes.get_mut("1") {
            init.children.push(pid.clone());
        }

        log::info!("VFS Process started: {} (PID: {})", name, pid);
        Ok(process)
    }

    /// Stop a running process
    pub fn stop_process(&mut self, pid: &str) -> Result<()> {
        let process = self
            .processes
            .get_mut(pid)
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
        let process = self
            .processes
            .get_mut(pid)
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
        self.processes
            .values()
            .filter(|p| p.state == ProcessState::Running || p.state == ProcessState::Starting)
            .count()
    }

    /// Get total memory usage by all processes
    pub fn memory_usage(&self) -> u64 {
        self.processes
            .values()
            .filter(|p| p.state == ProcessState::Running)
            .map(|p| p.memory_usage)
            .sum()
    }

    /// Simulate process execution tick (call periodically)
    pub fn tick(&mut self, uptime: u64) {
        for process in self.processes.values_mut() {
            if process.state == ProcessState::Running {
                // Simulate CPU and memory fluctuations
                // Use kernel uptime as seed to avoid relying on system clock during WASM tick
                let seed = uptime.wrapping_add(process.start_time as u64);

                let variation = ((seed % 100) as f64) / 100.0;
                process.cpu_usage = (process.cpu_usage + variation - 0.5).max(0.1).min(95.0);

                // Safe fluctuation of memory usage
                let mem_factor = 1.0 + variation * 0.01 - 0.005;
                process.memory_usage = (process.memory_usage as f64 * mem_factor) as u64;

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
    // Signal handling
    // ============================================================

    /// Send a signal to a process
    pub fn send_signal(&mut self, pid: &str, signal: Signal) -> Result<()> {
        let process = self
            .processes
            .get_mut(pid)
            .ok_or_else(|| KernelError::ProcessNotFound(pid.to_string()))?;

        log::info!(
            "Sending signal {:?} to process {} ({})",
            signal,
            pid,
            process.name
        );

        // Check if process has a custom handler
        let signal_num = signal as i32;
        let action = process
            .signal_handlers
            .get(&signal_num)
            .cloned()
            .unwrap_or_else(|| signal.default_action());

        match action {
            SignalAction::Terminate => {
                process.state = ProcessState::Exited(128 + signal_num);
                process.exit_code = Some(128 + signal_num);
                process.end_time = Some(Utc::now().timestamp());
                process
                    .stdout
                    .push_str(&format!("\nProcess terminated by signal {:?}\n", signal));
            }
            SignalAction::Stop => {
                process.state = ProcessState::Stopped;
                process.pending_signals.push(signal_num);
                process
                    .stdout
                    .push_str(&format!("\nProcess stopped by signal {:?}\n", signal));
            }
            SignalAction::Continue => {
                if process.state == ProcessState::Stopped {
                    process.state = ProcessState::Running;
                }
                process
                    .stdout
                    .push_str(&format!("\nProcess continued by signal {:?}\n", signal));
            }
            SignalAction::Ignore => {
                log::debug!("Process {} ignored signal {:?}", pid, signal);
            }
        }

        Ok(())
    }

    /// Kill a process with SIGKILL (force kill)
    pub fn kill_process(&mut self, pid: &str) -> Result<()> {
        let process = self
            .processes
            .get_mut(pid)
            .ok_or_else(|| KernelError::ProcessNotFound(pid.to_string()))?;

        log::info!("Killing process {} ({})", pid, process.name);

        process.state = ProcessState::Exited(137); // 128 + 9 (SIGKILL)
        process.exit_code = Some(137);
        process.end_time = Some(Utc::now().timestamp());
        process.stdout.push_str("\nProcess killed\n");

        Ok(())
    }

    /// Set a signal handler for a process
    pub fn set_signal_handler(
        &mut self,
        pid: &str,
        signal: Signal,
        action: SignalAction,
    ) -> Result<()> {
        let process = self
            .processes
            .get_mut(pid)
            .ok_or_else(|| KernelError::ProcessNotFound(pid.to_string()))?;

        process.signal_handlers.insert(signal as i32, action);
        Ok(())
    }

    // ============================================================
    // Pipe management
    // ============================================================

    /// Create a pipe between two processes
    pub fn create_pipe(&mut self, reader_pid: &str, writer_pid: &str) -> Result<String> {
        let pipe_id = format!("pipe-{}", self.process_counter);
        self.process_counter += 1;

        let pipe = Pipe {
            id: pipe_id.clone(),
            buffer: Vec::new(),
            reader_pid: Some(reader_pid.to_string()),
            writer_pid: Some(writer_pid.to_string()),
        };

        self.pipes.insert(pipe_id.clone(), pipe);

        // Set pipe_id on both processes
        if let Some(reader) = self.processes.get_mut(reader_pid) {
            reader.pipe_id = Some(pipe_id.clone());
        }
        if let Some(writer) = self.processes.get_mut(writer_pid) {
            writer.pipe_id = Some(pipe_id.clone());
        }

        log::info!(
            "Pipe created: {} ({} -> {})",
            pipe_id,
            writer_pid,
            reader_pid
        );
        Ok(pipe_id)
    }

    /// Write to a pipe
    pub fn write_to_pipe(&mut self, pipe_id: &str, data: &[u8]) -> Result<()> {
        let pipe = self
            .pipes
            .get_mut(pipe_id)
            .ok_or_else(|| KernelError::ExecutionError(format!("Pipe not found: {}", pipe_id)))?;

        pipe.buffer.extend_from_slice(data);
        Ok(())
    }

    /// Read from a pipe
    pub fn read_from_pipe(&mut self, pipe_id: &str, max_bytes: usize) -> Result<Vec<u8>> {
        let pipe = self
            .pipes
            .get_mut(pipe_id)
            .ok_or_else(|| KernelError::ExecutionError(format!("Pipe not found: {}", pipe_id)))?;

        let bytes_to_read = pipe.buffer.len().min(max_bytes);
        let data = pipe.buffer.drain(..bytes_to_read).collect();
        Ok(data)
    }

    /// Close a pipe
    pub fn close_pipe(&mut self, pipe_id: &str) -> Result<()> {
        let pipe = self
            .pipes
            .remove(pipe_id)
            .ok_or_else(|| KernelError::ExecutionError(format!("Pipe not found: {}", pipe_id)))?;

        // Clear pipe_id from both processes
        if let Some(pid) = pipe.reader_pid {
            if let Some(process) = self.processes.get_mut(&pid) {
                process.pipe_id = None;
            }
        }
        if let Some(pid) = pipe.writer_pid {
            if let Some(process) = self.processes.get_mut(&pid) {
                process.pipe_id = None;
            }
        }

        log::info!("Pipe closed: {}", pipe_id);
        Ok(())
    }

    // ============================================================
    // Helper functions
    // ============================================================

    /// Get base Linux environment
    fn get_base_env(&self) -> HashMap<String, String> {
        let mut env = HashMap::new();
        env.insert(
            "PATH".to_string(),
            "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
        );
        env.insert("HOME".to_string(), "/root".to_string());
        env.insert("TERM".to_string(), "xterm-256color".to_string());
        env.insert("SHELL".to_string(), "/bin/bash".to_string());
        env.insert("USER".to_string(), "root".to_string());
        env.insert("LANG".to_string(), "C.UTF-8".to_string());
        env
    }

    /// Get default environment for a binary
    fn get_default_env(&self, binary: &BinaryInfo) -> HashMap<String, String> {
        let mut env = self.get_base_env();

        // Standard Linux environment extras
        env.insert(
            "LD_LIBRARY_PATH".to_string(),
            "/usr/lib:/usr/local/lib".to_string(),
        );

        // Binary-specific
        env.insert("TRMON_BINARY".to_string(), binary.name.clone());
        env.insert("TRMON_BINARY_ID".to_string(), binary.id.clone());
        env.insert("TRMON_SANDBOX".to_string(), "1".to_string());

        env
    }
}
