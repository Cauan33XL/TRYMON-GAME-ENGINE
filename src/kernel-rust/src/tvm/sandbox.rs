//! TVM Sandbox and Security
//!
//! Provides security boundaries and resource limits for TVM execution.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Allowed syscalls (whitelist approach for converted ELF binaries)
static ALLOWED_SYSCALLS: &[i32] = &[
    // File I/O (basic)
    0,  // read
    1,  // write
    2,  // open
    3,  // close
    4,  // stat
    5,  // fstat
    6,  // lstat
    8,  // lseek
    9,  // mmap
    10, // mprotect
    11, // munmap
    12, // brk
    21, // access
    22, // access (faccessat)
    // Process
    39, // getpid
    57, // fork
    59, // execve
    60, // exit
    61, // wait4
    62, // kill
    // Memory
    78, // getdents
    96, // gettimeofday
    97, // getrlimit
    99, // getrusage
    // User/Group
    102, // getuid
    104, // getgid
    107, // geteuid
    108, // getegid
    // Directory
    79,  // getcwd
    80,  // chdir
    257, // openat
    258, // mkdirat
    259, // mknodat
    260, // fstatat
    261, // unlinkat
    262, // renameat
    263, // linkat
    264, // symlinkat
    265, // readlinkat
    266, // fchmodat
    267, // fchownat
    268, // fdopendir
    269, // getdents64
    // Time
    160, // uname
    201, // time
    113, // clock_gettime
    // Signal
    129, // rt_sigaction
    135, // rt_sigprocmask
    // Misc
    231, // exit_group
    231, // exit_group
    18,  // sigaltstack
    5,   // ioctl (basic)
    // Socket (basic - no network)
    41, // socket (returns -1)
    42, // connect (returns -1)
    43, // accept (returns -1)
];

/// Sandbox configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// Enable syscall whitelist
    pub enable_syscall_whitelist: bool,
    /// Enable memory bounds checking
    pub enable_memory_bounds: bool,
    /// Enable resource limits
    pub enable_resource_limits: bool,
    /// Max memory (bytes)
    pub max_memory: usize,
    /// Max instructions per second
    pub max_instructions_per_second: u64,
    /// Max syscalls per second
    pub max_syscalls_per_second: u64,
    /// Max call stack depth
    pub max_call_depth: usize,
    /// Allowed network domains (empty = none)
    pub allowed_network_domains: Vec<String>,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            enable_syscall_whitelist: true,
            enable_memory_bounds: true,
            enable_resource_limits: true,
            max_memory: 64 * 1024 * 1024, // 64MB
            max_instructions_per_second: 1_000_000,
            max_syscalls_per_second: 10_000,
            max_call_depth: 256,
            allowed_network_domains: Vec::new(),
        }
    }
}

/// Sandbox permissions
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Permission {
    /// Can read files
    ReadFile,
    /// Can write files
    WriteFile,
    /// Can create files
    CreateFile,
    /// Can access network
    Network,
    /// Can spawn processes
    SpawnProcess,
    /// Can load native libraries
    LoadLibrary,
}

impl SandboxConfig {
    /// Check if syscall is allowed
    pub fn is_syscall_allowed(&self, syscall: i32) -> bool {
        if !self.enable_syscall_whitelist {
            return true;
        }
        ALLOWED_SYSCALLS.contains(&syscall)
    }

    /// Check if permission is granted
    pub fn has_permission(&self, perm: &Permission) -> bool {
        match perm {
            Permission::Network => !self.allowed_network_domains.is_empty(),
            _ => true,
        }
    }
}

/// Sandbox state
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SandboxState {
    /// Instructions executed this second
    pub instructions_this_second: u64,
    /// Syscalls this second
    pub syscalls_this_second: u64,
    /// Last timestamp for rate limiting
    pub last_check: u64,
    /// Current memory usage
    pub current_memory: usize,
    /// Call stack depth
    pub call_depth: usize,
    /// Denied syscalls counter
    pub denied_syscalls: u64,
    /// Violations
    pub violations: Vec<SandboxViolation>,
}

/// Sandbox violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxViolation {
    /// Violation type
    pub violation_type: ViolationType,
    /// Details
    pub details: String,
    /// Timestamp
    pub timestamp: u64,
}

/// Violation types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ViolationType {
    /// Syscall not allowed
    SyscallDenied,
    /// Memory access violation
    MemoryViolation,
    /// Resource limit exceeded
    ResourceLimit,
    /// Permission denied
    PermissionDenied,
}

/// TVM Sandbox
pub struct Sandbox {
    /// Configuration
    config: SandboxConfig,
    /// Current state
    state: SandboxState,
    /// Permissions granted
    permissions: HashSet<Permission>,
}

impl Sandbox {
    /// Create new sandbox with config
    pub fn new(config: SandboxConfig) -> Self {
        Self {
            config,
            state: SandboxState::default(),
            permissions: HashSet::new(),
        }
    }

    /// Create with default config
    pub fn new_default() -> Self {
        Self::new(SandboxConfig::default())
    }

    /// Check and update rate limits
    pub fn check_rate_limits(&mut self, current_time: u64) -> Result<(), SandboxError> {
        if !self.config.enable_resource_limits {
            return Ok(());
        }

        // Reset counters every second
        if current_time - self.state.last_check >= 1000 {
            self.state.instructions_this_second = 0;
            self.state.syscalls_this_second = 0;
            self.state.last_check = current_time;
        }

        // Check limits
        if self.state.instructions_this_second > self.config.max_instructions_per_second {
            return Err(SandboxError::ResourceLimitExceeded(
                "Too many instructions per second".to_string(),
            ));
        }

        if self.state.syscalls_this_second > self.config.max_syscalls_per_second {
            return Err(SandboxError::ResourceLimitExceeded(
                "Too many syscalls per second".to_string(),
            ));
        }

        Ok(())
    }

    /// Check syscall permission
    pub fn check_syscall(&mut self, syscall: i32) -> Result<(), SandboxError> {
        if !self.config.is_syscall_allowed(syscall) {
            self.state.denied_syscalls += 1;
            self.state.violations.push(SandboxViolation {
                violation_type: ViolationType::SyscallDenied,
                details: format!("Syscall {} denied", syscall),
                timestamp: self.state.last_check,
            });
            return Err(SandboxError::SyscallDenied(syscall));
        }

        self.state.syscalls_this_second += 1;
        Ok(())
    }

    /// Check memory access
    pub fn check_memory(&self, addr: usize, size: usize) -> Result<(), SandboxError> {
        if !self.config.enable_memory_bounds {
            return Ok(());
        }

        if addr + size > self.config.max_memory {
            return Err(SandboxError::MemoryViolation(format!(
                "Memory access out of bounds: addr={}, size={}, limit={}",
                addr, size, self.config.max_memory
            )));
        }

        Ok(())
    }

    /// Check call depth
    pub fn check_call_depth(&mut self) -> Result<(), SandboxError> {
        self.state.call_depth += 1;

        if self.state.call_depth > self.config.max_call_depth {
            return Err(SandboxError::ResourceLimitExceeded(
                "Call stack depth exceeded".to_string(),
            ));
        }

        Ok(())
    }

    /// Pop call frame
    pub fn pop_call(&mut self) {
        self.state.call_depth = self.state.call_depth.saturating_sub(1);
    }

    /// Check memory limit
    pub fn check_memory_allocation(&self, size: usize) -> Result<(), SandboxError> {
        let new_total = self.state.current_memory + size;

        if new_total > self.config.max_memory {
            return Err(SandboxError::ResourceLimitExceeded(format!(
                "Memory allocation would exceed limit: {} + {} > {}",
                self.state.current_memory, size, self.config.max_memory
            )));
        }

        Ok(())
    }

    /// Update memory usage
    pub fn update_memory(&mut self, delta: isize) {
        if delta > 0 {
            self.state.current_memory = self.state.current_memory.saturating_add(delta as usize);
        } else {
            self.state.current_memory = self.state.current_memory.saturating_sub((-delta) as usize);
        }
    }

    /// Grant permission
    pub fn grant_permission(&mut self, perm: Permission) {
        self.permissions.insert(perm);
    }

    /// Check permission
    pub fn has_permission(&self, perm: &Permission) -> bool {
        self.config.has_permission(perm) && self.permissions.contains(perm)
    }

    /// Get state
    pub fn state(&self) -> &SandboxState {
        &self.state
    }

    /// Reset state
    pub fn reset(&mut self) {
        self.state = SandboxState::default();
    }

    /// Get configuration
    pub fn config(&self) -> &SandboxConfig {
        &self.config
    }
}

/// Sandbox errors
#[derive(Debug, Clone)]
pub enum SandboxError {
    /// Syscall not in whitelist
    SyscallDenied(i32),
    /// Memory access violation
    MemoryViolation(String),
    /// Resource limit exceeded
    ResourceLimitExceeded(String),
    /// Permission denied
    PermissionDenied(String),
}

impl std::fmt::Display for SandboxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SyscallDenied(n) => write!(f, "Syscall {} denied", n),
            Self::MemoryViolation(msg) => write!(f, "Memory violation: {}", msg),
            Self::ResourceLimitExceeded(msg) => write!(f, "Resource limit: {}", msg),
            Self::PermissionDenied(msg) => write!(f, "Permission denied: {}", msg),
        }
    }
}

/// Global sandbox instance for TVM
use once_cell::sync::Lazy;
use parking_lot::Mutex;

static GLOBAL_SANDBOX: Lazy<Mutex<Sandbox>> = Lazy::new(|| Mutex::new(Sandbox::new_default()));

/// Initialize sandbox
pub fn sandbox_init() {
    GLOBAL_SANDBOX.lock().reset();
    log::info!("TVM Sandbox initialized");
}

/// Check syscall
pub fn sandbox_check_syscall(syscall: i32) -> Result<(), SandboxError> {
    GLOBAL_SANDBOX.lock().check_syscall(syscall)
}

/// Check memory access
pub fn sandbox_check_memory(addr: usize, size: usize) -> Result<(), SandboxError> {
    GLOBAL_SANDBOX.lock().check_memory(addr, size)
}

/// Check call depth
pub fn sandbox_check_call() -> Result<(), SandboxError> {
    GLOBAL_SANDBOX.lock().check_call_depth()
}

/// Pop call
pub fn sandbox_pop_call() {
    GLOBAL_SANDBOX.lock().pop_call();
}

/// Get sandbox state as JSON
pub fn sandbox_status() -> String {
    let state = GLOBAL_SANDBOX.lock().state().clone();
    serde_json::to_string(&state).unwrap_or_default()
}
