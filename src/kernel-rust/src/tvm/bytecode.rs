//! TVM Bytecode Format Definitions
//!
//! Defines the .trymon bytecode format, opcodes, and instruction structure.

use serde::{Deserialize, Serialize};

/// TVM Bytecode magic identifier
pub const TVM_MAGIC: &[u8; 4] = b"TVM1";

/// Current bytecode version
pub const TVM_VERSION: u16 = 1;

/// Maximum TVM bytecode size (16MB)
pub const MAX_BYTECODE_SIZE: usize = 16 * 1024 * 1024;

/// Maximum constants pool size (4MB)
pub const MAX_CONSTANTS_SIZE: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PackageFlags {
    /// Package is executable (run directly)
    Executable = 0x01,
    /// Package is installable (persist to VFS)
    Installable = 0x02,
    /// Package has native dependencies
    HasNativeDeps = 0x04,
    /// Package requires network
    RequiresNetwork = 0x08,
}

/// TVM Bytecode file format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TVMBytecode {
    /// Magic bytes (TVM1)
    pub magic: [u8; 4],
    /// Bytecode version
    pub version: u16,
    /// Flags: bit0=executable, bit1=installable
    pub flags: u16,
    /// Entry point instruction offset
    pub entry_point: u32,
    /// Number of instructions
    pub instruction_count: u32,
    /// Constants pool offset
    pub constants_offset: u32,
    /// Constants pool size
    pub constants_size: u32,
    /// Code section offset
    pub code_offset: u32,
    /// Code section size
    pub code_size: u32,
    /// Instructions (variable length)
    pub instructions: Vec<u8>,
    /// Constants pool (strings, numbers, etc.)
    pub constants: Vec<u8>,
}

impl Default for TVMBytecode {
    fn default() -> Self {
        Self {
            magic: *TVM_MAGIC,
            version: TVM_VERSION,
            flags: 0,
            entry_point: 0,
            instruction_count: 0,
            constants_offset: 0,
            constants_size: 0,
            code_offset: 0,
            code_size: 0,
            instructions: Vec::new(),
            constants: Vec::new(),
        }
    }
}

/// Trymon Environment - self-contained package with embedded ELF
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrymonEnvironment {
    /// TVM Bytecode wrapper (simple syscall bridge)
    pub bytecode: TVMBytecode,
    /// Embedded original ELF binary data
    pub embedded_elf: Vec<u8>,
    /// Required libraries (will be loaded from v86)
    pub dependencies: Vec<String>,
    /// Entry point offset in embedded ELF
    pub entry_offset: u64,
    /// Whether this is an AppImage
    pub is_appimage: bool,
}

impl TrymonEnvironment {
    /// Create a new environment with embedded ELF
    pub fn new(elf_data: Vec<u8>, entry_offset: u64, is_appimage: bool) -> Self {
        let wrapper = create_syscall_bridge_wrapper();

        Self {
            bytecode: wrapper,
            embedded_elf: elf_data,
            dependencies: Vec::new(),
            entry_offset,
            is_appimage,
        }
    }
}

/// Create a simple syscall bridge wrapper
fn create_syscall_bridge_wrapper() -> TVMBytecode {
    let mut instructions = Vec::new();

    // ENTER_PROT - enter protected mode
    instructions.push(0x71); // ENTER_PROT
    instructions.extend_from_slice(&[0u8; 3]);

    // SYSCALL 0x3e (execve via v86)
    instructions.push(0x70); // SYSCALL
    instructions.push(0x3e);
    instructions.extend_from_slice(&[0u8; 2]);

    // MOVI R0, 0 (success)
    instructions.push(0x61); // MOVI
    instructions.push(0);
    instructions.extend_from_slice(&0u32.to_le_bytes());

    // SYSCALL 60 (exit)
    instructions.push(0x70); // SYSCALL
    instructions.push(60);
    instructions.extend_from_slice(&[0u8; 2]);

    // EXIT_PROT
    instructions.push(0x72); // EXIT_PROT
    instructions.extend_from_slice(&[0u8; 3]);

    // HALT
    instructions.push(0x58); // HALT
    instructions.extend_from_slice(&[0u8; 3]);

    TVMBytecode {
        magic: *TVM_MAGIC,
        version: TVM_VERSION,
        flags: 0x01, // executable
        entry_point: 0,
        instruction_count: (instructions.len() / 4) as u32,
        constants_offset: 0,
        constants_size: 0,
        code_offset: 0,
        code_size: instructions.len() as u32,
        instructions,
        constants: Vec::new(),
    }
}

/// TVM Opcodes enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opcode {
    // Stack operations (0x00-0x0F)
    /// Push immediate (1 byte value)
    PUSH_IMM8 = 0x00,
    /// Push immediate (4 bytes)
    PUSH_IMM32 = 0x01,
    /// Push from constant pool
    PUSH_CONST = 0x02,
    /// Pop stack
    POP = 0x03,
    /// Duplicate top of stack
    DUP = 0x04,
    /// Swap top two stack values
    SWAP = 0x05,
    /// Rotate top three stack values
    ROT = 0x06,

    // Arithmetic operations (0x10-0x1F)
    /// Add two values
    ADD = 0x10,
    /// Subtract
    SUB = 0x11,
    /// Multiply
    MUL = 0x12,
    /// Divide
    DIV = 0x13,
    /// Modulo
    MOD = 0x14,
    /// Negate
    NEG = 0x15,
    /// Increment
    INC = 0x16,
    /// Decrement
    DEC = 0x17,

    // Bit operations (0x20-0x2F)
    /// Bitwise AND
    AND = 0x20,
    /// Bitwise OR
    OR = 0x21,
    /// Bitwise XOR
    XOR = 0x22,
    /// Bitwise NOT
    NOT = 0x23,
    /// Shift left
    SHL = 0x24,
    /// Shift right
    SHR = 0x25,

    // Comparison operations (0x30-0x3F)
    /// Compare equal
    CMP_EQ = 0x30,
    /// Compare not equal
    CMP_NE = 0x31,
    /// Compare less than
    CMP_LT = 0x32,
    /// Compare greater than
    CMP_GT = 0x33,
    /// Compare less or equal
    CMP_LE = 0x34,
    /// Compare greater or equal
    CMP_GE = 0x35,

    // Memory operations (0x40-0x4F)
    /// Load from memory (offset)
    LOAD = 0x40,
    /// Store to memory
    STORE = 0x41,
    /// Load from stack frame
    LOAD_FRAME = 0x42,
    /// Store to stack frame
    STORE_FRAME = 0x43,
    /// Allocate memory
    ALLOC = 0x44,
    /// Free memory
    FREE = 0x45,

    // Control flow (0x50-0x5F)
    /// Unconditional jump
    JMP = 0x50,
    /// Jump if zero (false)
    JZ = 0x51,
    /// Jump if not zero (true)
    JNZ = 0x52,
    /// Jump if less than
    JL = 0x53,
    /// Jump if greater than
    JG = 0x54,
    /// Call subroutine
    CALL = 0x55,
    /// Return from subroutine
    RET = 0x56,
    /// Return from function with value
    RET_VAL = 0x57,
    /// Halt execution
    HALT = 0x58,

    // Data movement (0x60-0x6F)
    /// Move register
    MOV = 0x60,
    /// Move immediate to register
    MOVI = 0x61,
    /// Load effective address
    LEA = 0x62,
    /// Copy memory
    MEMCPY = 0x63,

    // Function/Syscall (0x70-0x7F)
    /// System call
    SYSCALL = 0x70,
    /// Enter protected mode
    ENTER_PROT = 0x71,
    /// Exit protected mode
    EXIT_PROT = 0x72,
    /// Breakpoint (debug)
    BREAK = 0x73,
    /// No operation
    NOP = 0x74,

    // Type operations (0x80-0x8F)
    /// Type conversion (int to float)
    I2F = 0x80,
    /// Type conversion (float to int)
    F2I = 0x81,
    /// Type conversion (int to string)
    I2S = 0x82,
    /// Type check
    TYPEOF = 0x83,

    // Extended operations (0x90-0xFF)
    /// Get array length
    ARRAY_LEN = 0x90,
    /// Array index access
    ARRAY_GET = 0x91,
    /// Array index set
    ARRAY_SET = 0x92,
    /// Object property get
    OBJ_GET = 0x93,
    /// Object property set
    OBJ_SET = 0x94,
    /// String concat
    STR_CONCAT = 0x95,
    /// String length
    STR_LEN = 0x96,
    /// String slice
    STR_SLICE = 0x97,
}

impl Opcode {
    /// Parse opcode from byte
    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            0x00 => Some(Self::PUSH_IMM8),
            0x01 => Some(Self::PUSH_IMM32),
            0x02 => Some(Self::PUSH_CONST),
            0x03 => Some(Self::POP),
            0x04 => Some(Self::DUP),
            0x05 => Some(Self::SWAP),
            0x06 => Some(Self::ROT),
            0x10 => Some(Self::ADD),
            0x11 => Some(Self::SUB),
            0x12 => Some(Self::MUL),
            0x13 => Some(Self::DIV),
            0x14 => Some(Self::MOD),
            0x15 => Some(Self::NEG),
            0x16 => Some(Self::INC),
            0x17 => Some(Self::DEC),
            0x20 => Some(Self::AND),
            0x21 => Some(Self::OR),
            0x22 => Some(Self::XOR),
            0x23 => Some(Self::NOT),
            0x24 => Some(Self::SHL),
            0x25 => Some(Self::SHR),
            0x30 => Some(Self::CMP_EQ),
            0x31 => Some(Self::CMP_NE),
            0x32 => Some(Self::CMP_LT),
            0x33 => Some(Self::CMP_GT),
            0x34 => Some(Self::CMP_LE),
            0x35 => Some(Self::CMP_GE),
            0x40 => Some(Self::LOAD),
            0x41 => Some(Self::STORE),
            0x42 => Some(Self::LOAD_FRAME),
            0x43 => Some(Self::STORE_FRAME),
            0x44 => Some(Self::ALLOC),
            0x45 => Some(Self::FREE),
            0x50 => Some(Self::JMP),
            0x51 => Some(Self::JZ),
            0x52 => Some(Self::JNZ),
            0x53 => Some(Self::JL),
            0x54 => Some(Self::JG),
            0x55 => Some(Self::CALL),
            0x56 => Some(Self::RET),
            0x57 => Some(Self::RET_VAL),
            0x58 => Some(Self::HALT),
            0x60 => Some(Self::MOV),
            0x61 => Some(Self::MOVI),
            0x62 => Some(Self::LEA),
            0x63 => Some(Self::MEMCPY),
            0x70 => Some(Self::SYSCALL),
            0x71 => Some(Self::ENTER_PROT),
            0x72 => Some(Self::EXIT_PROT),
            0x73 => Some(Self::BREAK),
            0x74 => Some(Self::NOP),
            0x80 => Some(Self::I2F),
            0x81 => Some(Self::F2I),
            0x82 => Some(Self::I2S),
            0x83 => Some(Self::TYPEOF),
            0x90 => Some(Self::ARRAY_LEN),
            0x91 => Some(Self::ARRAY_GET),
            0x92 => Some(Self::ARRAY_SET),
            0x93 => Some(Self::OBJ_GET),
            0x94 => Some(Self::OBJ_SET),
            0x95 => Some(Self::STR_CONCAT),
            0x96 => Some(Self::STR_LEN),
            0x97 => Some(Self::STR_SLICE),
            _ => None,
        }
    }

    /// Get instruction size (including operands)
    pub fn operand_size(&self) -> usize {
        match self {
            Self::PUSH_IMM8 => 2,
            Self::PUSH_IMM32 => 5,
            Self::PUSH_CONST => 5,
            Self::MOVI => 6,
            Self::JMP | Self::JZ | Self::JNZ | Self::JL | Self::JG | Self::CALL => 5,
            Self::LOAD | Self::STORE | Self::LOAD_FRAME | Self::STORE_FRAME => 3,
            Self::ALLOC | Self::FREE | Self::ARRAY_GET | Self::ARRAY_SET => 3,
            Self::SYSCALL => 2,
            _ => 1,
        }
    }
}

/// Register definitions for TVM
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Register {
    /// Return value
    R0 = 0,
    /// General purpose
    R1 = 1,
    R2 = 2,
    R3 = 3,
    R4 = 4,
    R5 = 5,
    R6 = 6,
    R7 = 7,
    /// Stack pointer
    SP = 8,
    /// Base pointer
    BP = 9,
    /// Program counter
    PC = 10,
    /// Flags register
    FLAGS = 11,
    /// Reserved for system
    SYS = 12,
}

impl Register {
    /// Get register index
    pub fn index(&self) -> usize {
        *self as usize
    }

    /// Parse from byte
    pub fn from_byte(byte: u8) -> Option<Self> {
        if byte <= 12 {
            Some(unsafe { std::mem::transmute(byte) })
        } else {
            None
        }
    }
}

/// Value types in TVM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TVMValue {
    /// 32-bit signed integer
    Integer(i32),
    /// 32-bit unsigned integer
    UInteger(u32),
    /// 64-bit float
    Float(f64),
    /// Boolean
    Bool(bool),
    /// String reference (offset in constants pool)
    String(u32),
    /// Pointer to memory
    Pointer(u32),
    /// Null pointer
    Null,
    /// Array
    Array(Vec<TVMValue>),
    /// Object
    Object(std::collections::HashMap<String, TVMValue>),
}

impl TVMValue {
    /// Get as i32
    pub fn as_i32(&self) -> Option<i32> {
        match self {
            Self::Integer(v) => Some(*v),
            Self::UInteger(v) => Some(*v as i32),
            _ => None,
        }
    }

    /// Get as u32
    pub fn as_u32(&self) -> Option<u32> {
        match self {
            Self::UInteger(v) => Some(*v),
            Self::Integer(v) => Some(*v as u32),
            _ => None,
        }
    }

    /// Get as f64
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Float(v) => Some(*v),
            _ => None,
        }
    }

    /// Get as bool
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(v) => Some(*v),
            _ => None,
        }
    }

    /// Convert to boolean (truthy check)
    pub fn to_bool(&self) -> bool {
        match self {
            Self::Integer(v) => *v != 0,
            Self::UInteger(v) => *v != 0,
            Self::Float(v) => *v != 0.0,
            Self::Bool(v) => *v,
            Self::Null => false,
            Self::String(_) => true,
            Self::Array(arr) => !arr.is_empty(),
            Self::Object(obj) => !obj.is_empty(),
            Self::Pointer(p) => *p != 0,
        }
    }
}

/// Instruction decoding result
#[derive(Debug)]
pub struct DecodedInstruction {
    /// Opcode
    pub opcode: Opcode,
    /// Operands bytes
    pub operands: Vec<u8>,
    /// Full instruction size
    pub size: usize,
}

impl DecodedInstruction {
    /// Decode from bytecode at offset
    pub fn decode(data: &[u8], offset: usize) -> Option<Self> {
        if offset >= data.len() {
            return None;
        }

        let opcode = Opcode::from_byte(data[offset])?;
        let operand_size = opcode.operand_size() - 1;
        let size = 1 + operand_size;

        if offset + size > data.len() {
            return None;
        }

        let operands = data[offset + 1..offset + size].to_vec();

        Some(Self {
            opcode,
            operands,
            size,
        })
    }
}

/// Package metadata (stored in .trymon file)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageMetadata {
    /// Package name
    pub name: Option<String>,
    /// Package version
    pub version: Option<String>,
    /// Entry point function name
    pub entry: Option<String>,
    /// Description
    pub description: Option<String>,
    /// Author/maintainer
    pub author: Option<String>,
    /// Icon (base64)
    pub icon: Option<String>,
    /// Dependencies
    pub dependencies: Vec<String>,
    /// Required permissions
    pub permissions: Vec<String>,
    /// Installation path (for installable packages)
    pub install_path: Option<String>,
}

impl Default for PackageMetadata {
    fn default() -> Self {
        Self {
            name: None,
            version: Some("1.0.0".to_string()),
            entry: Some("main".to_string()),
            description: None,
            author: None,
            icon: None,
            dependencies: Vec::new(),
            permissions: Vec::new(),
            install_path: None,
        }
    }
}

/// Result of compilation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileResult {
    /// Whether compilation succeeded
    pub success: bool,
    /// Compiled bytecode
    pub bytecode: Option<TVMBytecode>,
    /// Error message if failed
    pub error: Option<String>,
    /// Warning messages
    pub warnings: Vec<String>,
    /// Size of compiled bytecode
    pub size: usize,
}

impl CompileResult {
    /// Create success result
    pub fn success(bytecode: TVMBytecode) -> Self {
        let size = bytecode.code_size as usize;
        Self {
            success: true,
            bytecode: Some(bytecode),
            error: None,
            warnings: Vec::new(),
            size,
        }
    }

    /// Create error result
    pub fn error(msg: String) -> Self {
        Self {
            success: false,
            bytecode: None,
            error: Some(msg),
            warnings: Vec::new(),
            size: 0,
        }
    }

    /// Add warning
    pub fn with_warning(mut self, warning: &str) -> Self {
        self.warnings.push(warning.to_string());
        self
    }
}
