//! TVM Virtual Machine State
//!
//! Manages the runtime state of the TVM including execution context,
//! call stack, and execution control.

use super::bytecode::{DecodedInstruction, Opcode, TVMBytecode};
use super::memory::{MemoryManager, RegisterFile};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Maximum call stack depth
pub const MAX_CALL_DEPTH: usize = 256;

/// Maximum executed instructions per run
pub const MAX_INSTRUCTIONS: u64 = 10_000_000;

/// Execution state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionState {
    /// VM is idle
    Idle,
    /// VM is running
    Running,
    /// VM paused (awaiting input)
    Paused,
    /// VM finished normally
    Terminated,
    /// VM encountered error
    Error,
}

/// Exit reason
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExitReason {
    /// Normal program exit
    Normal(i32),
    /// Program called HALT
    Halt(i32),
    /// Unhandled exception
    Exception(String),
    /// Out of instructions limit
    OutOfInstructions,
    /// Stack overflow
    StackOverflow,
    /// Invalid memory access
    MemoryError(String),
}

/// Call frame for function calls
#[derive(Debug, Clone)]
pub struct CallFrame {
    /// Return address (instruction offset)
    pub return_addr: u32,
    /// Base pointer at call time
    pub bp: u32,
    /// Function name (for debugging)
    pub function_name: Option<String>,
}

/// Execution statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExecutionStats {
    /// Total instructions executed
    pub instructions_executed: u64,
    /// Number of function calls
    pub function_calls: u64,
    /// Number of syscalls
    pub syscall_count: u64,
    /// Memory allocations
    pub allocations: u64,
    /// Current CPU (simulated cycles)
    pub cycles: u64,
}

/// TVM Virtual Machine
pub struct TVM {
    /// Loaded bytecode
    bytecode: Option<TVMBytecode>,
    /// Memory manager
    memory: MemoryManager,
    /// Register file
    registers: RegisterFile,
    /// Call stack
    call_stack: Vec<CallFrame>,
    /// Evaluation stack (for TVM interpreter)
    eval_stack: Vec<i64>,
    /// Current execution state
    state: ExecutionState,
    /// Exit reason
    exit_reason: Option<ExitReason>,
    /// Exit code
    exit_code: i32,
    /// Standard output buffer
    stdout: String,
    /// Standard error buffer
    stderr: String,
    /// Execution statistics
    stats: ExecutionStats,
    /// Breakpoints set
    breakpoints: HashMap<u32, bool>,
    /// Current instruction offset
    current_offset: u32,
    /// Syscall handler (set externally)
    syscall_handler: Option<Box<dyn FnMut(u32, &mut TVM) -> i32 + Send + Sync>>,
}

impl TVM {
    /// Create new TVM instance
    pub fn new(memory_limit: usize) -> Self {
        Self {
            bytecode: None,
            memory: MemoryManager::new(memory_limit),
            registers: RegisterFile::new(),
            call_stack: Vec::with_capacity(MAX_CALL_DEPTH),
            eval_stack: Vec::new(),
            state: ExecutionState::Idle,
            exit_reason: None,
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            stats: ExecutionStats::default(),
            breakpoints: HashMap::new(),
            current_offset: 0,
            syscall_handler: None,
        }
    }

    /// Create with default memory
    pub fn new_default() -> Self {
        Self::new(64 * 1024 * 1024)
    }

    /// Load bytecode into VM
    pub fn load(&mut self, bytecode: TVMBytecode) -> Result<(), String> {
        if bytecode.magic != *super::bytecode::TVM_MAGIC {
            return Err("Invalid bytecode magic".to_string());
        }

        if bytecode.version > super::bytecode::TVM_VERSION {
            return Err(format!(
                "Bytecode version {} not supported (max: {})",
                bytecode.version,
                super::bytecode::TVM_VERSION
            ));
        }

        // Load bytecode into memory
        self.bytecode = Some(bytecode);
        self.state = ExecutionState::Idle;

        log::info!(
            "TVM: Bytecode loaded ({} bytes)",
            self.bytecode.as_ref().map(|b| b.code_size).unwrap_or(0)
        );
        Ok(())
    }

    /// Reset VM for new execution
    pub fn reset(&mut self) {
        self.registers.reset();
        self.call_stack.clear();
        self.eval_stack.clear();
        self.stdout.clear();
        self.stderr.clear();
        self.stats = ExecutionStats::default();
        self.memory.reset();
        self.current_offset = 0;
        self.exit_reason = None;

        // Re-setup stack
        self.registers.sp = self.memory.limit() as u32;
        self.registers.bp = self.registers.sp;
    }

    /// Start execution from entry point
    pub fn run(&mut self) -> Result<i32, String> {
        let entry_point = {
            let bytecode = self.bytecode.as_ref().ok_or("No bytecode loaded")?;
            bytecode.entry_point
        };

        self.reset();

        // Set entry point
        self.registers.pc = entry_point;
        self.current_offset = entry_point;
        self.state = ExecutionState::Running;

        log::info!("TVM: Starting execution at offset {}", entry_point);

        // Main execution loop
        while self.state == ExecutionState::Running {
            if self.stats.instructions_executed >= MAX_INSTRUCTIONS {
                self.exit_reason = Some(ExitReason::OutOfInstructions);
                self.exit_code = -1;
                self.state = ExecutionState::Error;
                break;
            }

            if let Err(e) = self.execute_instruction() {
                self.exit_reason = Some(ExitReason::Exception(e));
                self.exit_code = -1;
                self.state = ExecutionState::Error;
                break;
            }

            self.stats.cycles += 1;
        }

        match &self.exit_reason {
            Some(reason) => {
                log::info!("TVM: Execution finished: {:?}", reason);
            }
            None => {
                log::info!("TVM: Execution finished normally");
            }
        }

        Ok(self.exit_code)
    }

    /// Execute a single instruction
    fn execute_instruction(&mut self) -> Result<(), String> {
        let bytecode = self.bytecode.as_ref().ok_or("No bytecode loaded")?;

        if self.current_offset as usize >= bytecode.instructions.len() {
            return Err("Program counter out of bounds".to_string());
        }

        // Decode instruction
        let inst = DecodedInstruction::decode(&bytecode.instructions, self.current_offset as usize)
            .ok_or_else(|| format!("Invalid instruction at offset {}", self.current_offset))?;

        self.current_offset += inst.size as u32;
        self.registers.pc = self.current_offset;
        self.stats.instructions_executed += 1;

        // Check breakpoint
        if let Some(_) = self.breakpoints.get(&self.current_offset) {
            log::debug!("TVM: Breakpoint hit at offset {}", self.current_offset);
            // Continue execution - breakpoints are for future debug support
        }

        // Execute opcode
        self.execute_opcode(inst.opcode, &inst.operands)
    }

    /// Execute an opcode
    fn execute_opcode(&mut self, opcode: Opcode, operands: &[u8]) -> Result<(), String> {
        match opcode {
            // Stack operations
            Opcode::PUSH_IMM8 => {
                let val = operands[0] as i32 as i64;
                self.eval_stack.push(val);
            }
            Opcode::PUSH_IMM32 => {
                let val =
                    i32::from_le_bytes([operands[0], operands[1], operands[2], operands[3]]) as i64;
                self.eval_stack.push(val);
            }
            Opcode::PUSH_CONST => {
                let idx = u32::from_le_bytes([operands[0], operands[1], operands[2], operands[3]]);
                // Push constant from pool (simplified - stores index as value)
                self.eval_stack.push(idx as i64);
            }
            Opcode::POP => {
                self.eval_stack.pop();
            }
            Opcode::DUP => {
                if let Some(&val) = self.eval_stack.last() {
                    self.eval_stack.push(val);
                }
            }
            Opcode::SWAP => {
                if self.eval_stack.len() >= 2 {
                    let len = self.eval_stack.len();
                    let last = len - 1;
                    let second = len - 2;
                    self.eval_stack.swap(last, second);
                }
            }
            Opcode::ROT => {
                if self.eval_stack.len() >= 3 {
                    let len = self.eval_stack.len();
                    self.eval_stack.swap(len - 1, len - 3);
                }
            }

            // Arithmetic
            Opcode::ADD => self.bin_op(|a, b| a + b)?,
            Opcode::SUB => self.bin_op(|a, b| a - b)?,
            Opcode::MUL => self.bin_op(|a, b| a * b)?,
            Opcode::DIV => {
                let b = self.eval_stack.pop().ok_or("Stack underflow")?;
                let a = self.eval_stack.pop().ok_or("Stack underflow")?;
                if b == 0 {
                    return Err("Division by zero".to_string());
                }
                self.eval_stack.push(a / b);
            }
            Opcode::MOD => {
                let b = self.eval_stack.pop().ok_or("Stack underflow")?;
                let a = self.eval_stack.pop().ok_or("Stack underflow")?;
                if b == 0 {
                    return Err("Modulo by zero".to_string());
                }
                self.eval_stack.push(a % b);
            }
            Opcode::NEG => {
                if let Some(val) = self.eval_stack.pop() {
                    self.eval_stack.push(-val);
                }
            }
            Opcode::INC => {
                if let Some(val) = self.eval_stack.last_mut() {
                    *val += 1;
                }
            }
            Opcode::DEC => {
                if let Some(val) = self.eval_stack.last_mut() {
                    *val -= 1;
                }
            }

            // Bit operations
            Opcode::AND => self.bin_op(|a, b| (a & b))?,
            Opcode::OR => self.bin_op(|a, b| (a | b))?,
            Opcode::XOR => self.bin_op(|a, b| (a ^ b))?,
            Opcode::NOT => {
                if let Some(val) = self.eval_stack.pop() {
                    self.eval_stack.push(!val);
                }
            }
            Opcode::SHL => self.bin_op(|a, b| a << b)?,
            Opcode::SHR => self.bin_op(|a, b| a >> b)?,

            // Comparison
            Opcode::CMP_EQ => self.bin_op(|a, b| (a == b) as i64)?,
            Opcode::CMP_NE => self.bin_op(|a, b| (a != b) as i64)?,
            Opcode::CMP_LT => self.bin_op(|a, b| (a < b) as i64)?,
            Opcode::CMP_GT => self.bin_op(|a, b| (a > b) as i64)?,
            Opcode::CMP_LE => self.bin_op(|a, b| (a <= b) as i64)?,
            Opcode::CMP_GE => self.bin_op(|a, b| (a >= b) as i64)?,

            // Control flow
            Opcode::JMP => {
                let target =
                    u32::from_le_bytes([operands[0], operands[1], operands[2], operands[3]]);
                self.current_offset = target;
                self.registers.pc = target;
            }
            Opcode::JZ => {
                let val = self.eval_stack.pop().unwrap_or(0);
                if val == 0 {
                    let target =
                        u32::from_le_bytes([operands[0], operands[1], operands[2], operands[3]]);
                    self.current_offset = target;
                    self.registers.pc = target;
                }
            }
            Opcode::JNZ => {
                let val = self.eval_stack.pop().unwrap_or(0);
                if val != 0 {
                    let target =
                        u32::from_le_bytes([operands[0], operands[1], operands[2], operands[3]]);
                    self.current_offset = target;
                    self.registers.pc = target;
                }
            }
            Opcode::CALL => {
                // Push return address
                let target =
                    u32::from_le_bytes([operands[0], operands[1], operands[2], operands[3]]);
                self.call_stack.push(CallFrame {
                    return_addr: self.current_offset,
                    bp: self.registers.bp,
                    function_name: None,
                });
                self.current_offset = target;
                self.registers.pc = target;
                self.stats.function_calls += 1;
            }
            Opcode::RET | Opcode::RET_VAL => {
                if let Some(frame) = self.call_stack.pop() {
                    self.current_offset = frame.return_addr;
                    self.registers.pc = frame.return_addr;
                    self.registers.bp = frame.bp;
                } else {
                    // Return from main - terminate
                    self.exit_reason = Some(ExitReason::Normal(self.exit_code));
                    self.state = ExecutionState::Terminated;
                }
            }
            Opcode::HALT => {
                let code = i32::from_le_bytes([operands[0], operands[1], operands[2], operands[3]]);
                self.exit_reason = Some(ExitReason::Halt(code));
                self.exit_code = code;
                self.state = ExecutionState::Terminated;
            }

            // Data movement
            Opcode::MOV => {
                let dst = operands[0] as usize;
                let src = operands[1] as usize;
                self.registers.set(dst, self.registers.get(src));
            }
            Opcode::MOVI => {
                let dst = operands[0] as usize;
                let val =
                    i32::from_le_bytes([operands[1], operands[2], operands[3], operands[4]]) as u32;
                self.registers.set(dst, val);
            }

            // Memory
            Opcode::LOAD => {
                if operands.len() >= 3 {
                    let addr = self.registers.get(operands[0] as usize) as usize;
                    let offset = u32::from_le_bytes([operands[1], operands[2], operands[3], 0]);
                    if let Some(val) = self.memory.read_value::<u32>(addr + offset as usize) {
                        self.registers.set(operands[0] as usize, val);
                    }
                }
            }
            Opcode::STORE => {
                if operands.len() >= 3 {
                    let addr = self.registers.get(operands[0] as usize) as usize;
                    let offset = u32::from_le_bytes([operands[1], operands[2], operands[3], 0]);
                    let val = self.registers.get(operands[0] as usize);
                    self.memory.write_value(addr + offset as usize, &val);
                }
            }
            Opcode::ALLOC => {
                let size = self.registers.get(operands[0] as usize);
                if let Some(addr) = self.memory.alloc(size as usize) {
                    self.registers.set(operands[0] as usize, addr);
                    self.stats.allocations += 1;
                }
            }
            Opcode::FREE => {
                let addr = self.registers.get(operands[0] as usize);
                self.memory.free(addr);
            }

            // Syscall
            Opcode::SYSCALL => {
                let syscall_num = self.registers.get(0); // syscall number in R0
                let result = self.handle_syscall(syscall_num);
                self.registers.set(0, result as u32); // result in R0
                self.stats.syscall_count += 1;
            }

            // Type operations
            Opcode::I2F => {} // TODO: float support
            Opcode::F2I => {}
            Opcode::I2S => {}
            Opcode::TYPEOF => {}

            // String/Array
            Opcode::STR_CONCAT
            | Opcode::ARRAY_LEN
            | Opcode::ARRAY_GET
            | Opcode::ARRAY_SET
            | Opcode::OBJ_GET
            | Opcode::OBJ_SET
            | Opcode::STR_LEN
            | Opcode::STR_SLICE => {
                // Simplified - these would need full implementation
            }

            // Other
            Opcode::NOP => {}
            Opcode::BREAK => {
                log::debug!("TVM: Breakpoint");
            }
            Opcode::ENTER_PROT | Opcode::EXIT_PROT => {
                // Sandbox - handled separately
            }

            // Memory operations not implemented
            Opcode::LOAD_FRAME | Opcode::STORE_FRAME | Opcode::MEMCPY | Opcode::LEA => {}
            Opcode::JL | Opcode::JG => {}
        }

        Ok(())
    }

    /// Binary operation helper
    fn bin_op<F>(&mut self, op: F) -> Result<(), String>
    where
        F: FnOnce(i64, i64) -> i64,
    {
        let b = self.eval_stack.pop().ok_or("Stack underflow")?;
        let a = self.eval_stack.pop().ok_or("Stack underflow")?;
        self.eval_stack.push(op(a, b));
        Ok(())
    }

    /// Handle syscall (to be implemented with full syscalls)
    fn handle_syscall(&mut self, num: u32) -> i32 {
        log::debug!("TVM: Syscall {}", num);

        // Default handler - will be replaced by full syscall handler
        match num {
            0 => 0,  // exit - handled by HALT opcode
            _ => -1, // unknown
        }
    }

    /// Set syscall handler
    pub fn set_syscall_handler<F>(&mut self, handler: F)
    where
        F: FnMut(u32, &mut TVM) -> i32 + Send + Sync + 'static,
    {
        self.syscall_handler = Some(Box::new(handler));
    }

    /// Get execution state
    pub fn state(&self) -> ExecutionState {
        self.state
    }

    /// Get exit code
    pub fn exit_code(&self) -> i32 {
        self.exit_code
    }

    /// Get stdout
    pub fn stdout(&self) -> &str {
        &self.stdout
    }

    /// Get stderr
    pub fn stderr(&self) -> &str {
        &self.stderr
    }

    /// Write to stdout
    pub fn write_stdout(&mut self, s: &str) {
        self.stdout.push_str(s);
    }

    /// Write to stderr
    pub fn write_stderr(&mut self, s: &str) {
        self.stderr.push_str(s);
    }

    /// Get statistics
    pub fn stats(&self) -> &ExecutionStats {
        &self.stats
    }

    /// Get memory manager reference
    pub fn memory(&mut self) -> &mut MemoryManager {
        &mut self.memory
    }

    /// Get register file reference
    pub fn registers(&mut self) -> &mut RegisterFile {
        &mut self.registers
    }

    /// Add breakpoint
    pub fn add_breakpoint(&mut self, offset: u32) {
        self.breakpoints.insert(offset, true);
    }

    /// Remove breakpoint
    pub fn remove_breakpoint(&mut self, offset: u32) {
        self.breakpoints.remove(&offset);
    }
}
