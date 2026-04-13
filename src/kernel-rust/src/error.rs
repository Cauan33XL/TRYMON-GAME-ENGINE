use thiserror::Error;
use wasm_bindgen::JsValue;

/// Main error type for kernel operations
#[derive(Error, Debug)]
pub enum KernelError {
    /// Binary loading failed
    #[error("Failed to load binary: {0}")]
    LoadError(String),

    /// Binary format not supported
    #[error("Unsupported binary format: {0}")]
    UnsupportedFormat(String),

    /// Binary parsing failed
    #[error("Failed to parse binary: {0}")]
    ParseError(String),

    /// Execution failed
    #[error("Failed to execute binary: {0}")]
    ExecutionError(String),

    /// Process not found
    #[error("Process not found: {0}")]
    ProcessNotFound(String),

    /// Filesystem error
    #[error("Filesystem error: {0}")]
    FileSystemError(String),

    /// Memory allocation failed
    #[error("Memory allocation failed: {0}")]
    MemoryError(String),

    /// Invalid binary file
    #[error("Invalid binary file: {0}")]
    InvalidBinary(String),

    /// Sandbox violation
    #[error("Sandbox violation: {0}")]
    SandboxError(String),

    /// Process crashed
    #[error("Process crashed with exit code: {0}")]
    ProcessCrashed(i32),

    /// I/O error
    #[error("I/O error: {0}")]
    IoError(String),
}

impl From<KernelError> for JsValue {
    fn from(error: KernelError) -> Self {
        JsValue::from_str(&error.to_string())
    }
}

/// Result type alias for kernel operations
pub type Result<T> = std::result::Result<T, KernelError>;
