//! TVM Compiler - ELF to TVM Bytecode
//!
//! Compiles Linux ELF binaries to TVM bytecode format for execution
//! in the Trymon Virtual Machine.

use super::bytecode::{
    CompileResult, Opcode, PackageMetadata, TVMBytecode, TVM_MAGIC, TVM_VERSION,
};
use std::collections::HashMap;

/// ELF constants
const ELF_MAGIC: &[u8; 4] = b"\x7fELF";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElfClass {
    ELF32 = 1,
    ELF64 = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElfEndian {
    Little = 1,
    Big = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElfType {
    None = 0,
    Relocatable = 1,
    Executable = 2,
    Shared = 3,
    Core = 4,
}

/// ELF Machine types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElfMachine {
    X86 = 0x03,
    X86_64 = 0x3E,
    ARM = 0x28,
    AARCH64 = 0xB7,
}

/// ELF Program header types
#[derive(Debug, Clone, Copy)]
pub enum ProgramType {
    PT_NULL = 0,
    PT_LOAD = 1,
    PT_DYNAMIC = 2,
    PT_INTERP = 3,
    PT_NOTE = 4,
    PT_SHLIB = 5,
    PT_PHDR = 6,
    PT_TLS = 7,
}

const SHN_UNDEF: u16 = 0;
const SHT_PROGBITS: u32 = 1;
const SHT_STRTAB: u32 = 2;
const SHT_SYMTAB: u32 = 3;
const SHT_RELA: u32 = 4;
const SHT_NOBITS: u32 = 8;
const SHT_REL: u32 = 9;
const SHF_ALLOC: u64 = 0x2;
const SHF_EXECINSTR: u64 = 0x4;

#[derive(Debug, Clone)]
pub struct ElfSection {
    pub name: String,
    pub addr: u64,
    pub offset: u64,
    pub size: u64,
    pub ty: u32,
    pub flags: u64,
}

#[derive(Debug, Clone)]
pub struct ElfSegment {
    pub ty: u32,
    pub offset: u64,
    pub vaddr: u64,
    pub filesz: u64,
    pub memsz: u64,
    pub flags: u32,
}

impl ElfSection {
    pub fn is_executable(&self) -> bool {
        (self.flags & SHF_EXECINSTR) != 0
    }

    pub fn is_allocated(&self) -> bool {
        (self.flags & SHF_ALLOC) != 0
    }

    pub fn is_code(&self) -> bool {
        self.ty == SHT_PROGBITS && self.is_executable()
    }

    pub fn is_data(&self) -> bool {
        self.ty == SHT_PROGBITS && !self.is_executable() && self.is_allocated()
    }

    pub fn is_bss(&self) -> bool {
        self.ty == SHT_NOBITS && self.is_allocated()
    }

    pub fn is_string_table(&self) -> bool {
        self.ty == SHT_STRTAB
    }
}

/// ELF Binary information
#[derive(Debug, Clone)]
pub struct ElfBinary {
    pub class: ElfClass,
    pub endian: ElfEndian,
    pub machine: ElfMachine,
    pub binary_type: ElfType,
    pub entry: u64,
    pub sections: Vec<ElfSection>,
    pub segments: Vec<ElfSegment>,
    pub data: Vec<u8>,
}

/// Compiler configuration
#[derive(Debug, Clone)]
pub struct CompilerConfig {
    /// Optimize for size
    pub optimize_size: bool,
    /// Enable debugging symbols
    pub debug: bool,
    /// Strip symbols
    pub strip_symbols: bool,
    /// Emit verbose output
    pub verbose: bool,
}

impl Default for CompilerConfig {
    fn default() -> Self {
        Self {
            optimize_size: false,
            debug: false,
            strip_symbols: false,
            verbose: false,
        }
    }
}

/// TVM Compiler - converts ELF to TVM bytecode
pub struct Compiler {
    /// Compiler configuration
    config: CompilerConfig,
    /// Constant pool (strings, numbers)
    constants: Vec<ConstantPoolEntry>,
    /// Symbol table
    symbols: HashMap<String, u32>,
    /// Generated instructions
    instructions: Vec<u8>,
    /// Entry point
    entry_point: u32,
}

#[derive(Debug, Clone)]
struct ConstantPoolEntry {
    offset: u32,
    data: Vec<u8>,
    constant_type: ConstantType,
}

#[derive(Debug, Clone, Copy)]
enum ConstantType {
    String,
    Integer,
    Float,
}

impl Compiler {
    /// Create new compiler
    pub fn new(config: CompilerConfig) -> Self {
        Self {
            config,
            constants: Vec::new(),
            symbols: HashMap::new(),
            instructions: Vec::new(),
            entry_point: 0,
        }
    }

    /// Create with default config
    pub fn new_default() -> Self {
        Self::new(CompilerConfig::default())
    }

    /// Compile ELF to TVM bytecode
    pub fn compile(&mut self, elf_data: &[u8], metadata: PackageMetadata) -> CompileResult {
        // Parse ELF
        let elf = match self.parse_elf(elf_data) {
            Ok(e) => e,
            Err(e) => return CompileResult::error(e),
        };

        if self.config.verbose {
            log::info!(
                "ELF: type={:?}, machine={:?}, entry=0x{:x}",
                elf.binary_type,
                elf.machine,
                elf.entry
            );
        }

        // Validate ELF - accept Executable, Shared (for AppImage), and Relocatable
        // AppImages often have Shared type because they're self-extracting archives
        match elf.binary_type {
            ElfType::Executable | ElfType::Shared | ElfType::Relocatable => {
                // Accept these types for TVM compilation
            }
            other => {
                return CompileResult::error(format!(
                    "ELF type {:?} not supported. Only executable, shared object, and relocatable ELF files are supported",
                    other
                ));
            }
        }

        if elf.machine != ElfMachine::X86_64 && elf.machine != ElfMachine::X86 {
            return CompileResult::error(format!("Unsupported machine: {:?}", elf.machine));
        }

        // Translate to TVM bytecode
        self.translate_elf(&elf);

        // Create final bytecode
        let bytecode = TVMBytecode {
            magic: *TVM_MAGIC,
            version: TVM_VERSION,
            flags: 0x01, // Executable
            entry_point: self.entry_point,
            instruction_count: (self.instructions.len() / 4) as u32,
            constants_offset: 0,
            constants_size: self.constants.len() as u32,
            code_offset: 0,
            code_size: self.instructions.len() as u32,
            instructions: self.instructions.clone(),
            constants: self.build_constant_pool(),
        };

        CompileResult::success(bytecode)
    }

    /// Parse ELF binary - defensivo com verificações de bounds
    fn parse_elf(&self, data: &[u8]) -> Result<ElfBinary, String> {
        log::info!("[Compiler] Starting ELF parsing ({} bytes)", data.len());

        if data.len() < 64 {
            log::error!("[Compiler] File too small: {} bytes", data.len());
            return Err("File too small to be ELF".to_string());
        }

        if &data[0..4] != ELF_MAGIC {
            log::error!("[Compiler] Invalid ELF magic: {:x?}", &data[0..4]);
            return Err("Invalid ELF magic".to_string());
        }

        let class = match data[4] {
            1 => ElfClass::ELF32,
            2 => ElfClass::ELF64,
            _ => {
                log::error!("[Compiler] Invalid ELF class: {}", data[4]);
                return Err("Invalid ELF class".to_string());
            }
        };

        let endian = match data[5] {
            1 => ElfEndian::Little,
            2 => ElfEndian::Big,
            _ => {
                log::error!("[Compiler] Invalid ELF endian: {}", data[5]);
                return Err("Invalid ELF endian".to_string());
            }
        };

        let machine = match u16::from_le_bytes([data[18], data[19]]) {
            0x03 => ElfMachine::X86,
            0x3E => ElfMachine::X86_64,
            0x28 => ElfMachine::ARM,
            0xB7 => ElfMachine::AARCH64,
            m => {
                log::error!("[Compiler] Unsupported machine: 0x{:x}", m);
                return Err(format!("Unsupported machine: 0x{:x}", m));
            }
        };

        let binary_type = match u16::from_le_bytes([data[16], data[17]]) {
            0 => ElfType::None,
            1 => ElfType::Relocatable,
            2 => ElfType::Executable,
            3 => ElfType::Shared,
            4 => ElfType::Core,
            t => {
                log::error!("[Compiler] Unknown ELF type: {}", t);
                return Err(format!("Unknown ELF type: {}", t));
            }
        };

        let is_64bit = class == ElfClass::ELF64;
        log::info!(
            "[Compiler] ELF: {} bit, type: {:?}, machine: {:?}",
            if is_64bit { "64" } else { "32" },
            binary_type,
            machine
        );

        let min_size = if is_64bit { 64 } else { 52 };
        if data.len() < min_size {
            log::error!("[Compiler] ELF truncated: {} < {}", data.len(), min_size);
            return Err(format!("ELF truncated: need at least {} bytes", min_size));
        }

        let entry = if is_64bit {
            u64::from_le_bytes(data[24..32].try_into().unwrap())
        } else {
            u32::from_le_bytes(data[24..28].try_into().unwrap()) as u64
        };

        let ph_offset = if is_64bit {
            u64::from_le_bytes(data[32..40].try_into().unwrap())
        } else {
            u32::from_le_bytes(data[28..32].try_into().unwrap()) as u64
        };

        let sh_offset = if is_64bit {
            u64::from_le_bytes(data[40..48].try_into().unwrap())
        } else {
            u32::from_le_bytes(data[32..36].try_into().unwrap()) as u64
        };

        let sections = if sh_offset > 0 && sh_offset < data.len() as u64 {
            self.parse_sections(data, is_64bit, sh_offset)?
        } else {
            Vec::new()
        };

        let segments = if ph_offset > 0 && ph_offset < data.len() as u64 {
            self.parse_segments(data, is_64bit, ph_offset)?
        } else {
            Vec::new()
        };

        Ok(ElfBinary {
            class,
            endian,
            machine,
            binary_type,
            entry,
            sections,
            segments,
            data: data.to_vec(),
        })
    }

    fn parse_sections(
        &self,
        data: &[u8],
        is_64bit: bool,
        sh_offset: u64,
    ) -> Result<Vec<ElfSection>, String> {
        let mut sections = Vec::new();

        let eheader_idx = if is_64bit { 64 } else { 52 };
        if data.len() < eheader_idx {
            log::warn!("[Compiler] No section headers (truncated header)");
            return Ok(sections);
        }

        let sh_entsize = if is_64bit {
            u16::from_le_bytes(data[58..60].try_into().unwrap()) as u64
        } else {
            u16::from_le_bytes(data[46..48].try_into().unwrap()) as u64
        };

        let sh_num = if is_64bit {
            u16::from_le_bytes(data[60..62].try_into().unwrap()) as u64
        } else {
            u16::from_le_bytes(data[48..50].try_into().unwrap()) as u64
        };

        let _sh_strndx = if is_64bit {
            u16::from_le_bytes(data[62..64].try_into().unwrap()) as u64
        } else {
            u16::from_le_bytes(data[50..52].try_into().unwrap()) as u64
        };

        if sh_num == 0 || sh_entsize == 0 {
            log::info!("[Compiler] No sections in ELF");
            return Ok(sections);
        }

        log::info!("[Compiler] Parsing {} sections", sh_num);

        for i in 0..sh_num {
            let sec_offset = sh_offset + i * sh_entsize;
            let sec_end = sec_offset + if is_64bit { 64 } else { 40 };
            if sec_end as usize > data.len() {
                log::warn!("[Compiler] Section {} truncated, skipping", i);
                break;
            }

            let (name_idx, ty, addr, offset, size, flags) = if is_64bit {
                let name_idx = u32::from_le_bytes(
                    data[sec_offset as usize..(sec_offset + 4) as usize]
                        .try_into()
                        .unwrap(),
                );
                let ty = u32::from_le_bytes(
                    data[(sec_offset + 4) as usize..(sec_offset + 8) as usize]
                        .try_into()
                        .unwrap(),
                );
                let addr = u64::from_le_bytes(
                    data[(sec_offset + 8) as usize..(sec_offset + 16) as usize]
                        .try_into()
                        .unwrap(),
                );
                let offset = u64::from_le_bytes(
                    data[(sec_offset + 16) as usize..(sec_offset + 24) as usize]
                        .try_into()
                        .unwrap(),
                );
                let size = u64::from_le_bytes(
                    data[(sec_offset + 24) as usize..(sec_offset + 32) as usize]
                        .try_into()
                        .unwrap(),
                );
                let flags = u64::from_le_bytes(
                    data[(sec_offset + 32) as usize..(sec_offset + 40) as usize]
                        .try_into()
                        .unwrap(),
                );
                (name_idx, ty, addr, offset, size, flags)
            } else {
                let name_idx = u32::from_le_bytes(
                    data[sec_offset as usize..(sec_offset + 4) as usize]
                        .try_into()
                        .unwrap(),
                );
                let ty = u32::from_le_bytes(
                    data[(sec_offset + 4) as usize..(sec_offset + 8) as usize]
                        .try_into()
                        .unwrap(),
                );
                let addr = u32::from_le_bytes(
                    data[(sec_offset + 8) as usize..(sec_offset + 12) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                let offset = u32::from_le_bytes(
                    data[(sec_offset + 12) as usize..(sec_offset + 16) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                let size = u32::from_le_bytes(
                    data[(sec_offset + 16) as usize..(sec_offset + 20) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                let flags = u32::from_le_bytes(
                    data[(sec_offset + 20) as usize..(sec_offset + 24) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                (name_idx, ty, addr, offset, size, flags)
            };

            let name = format!("section_{}", i);
            sections.push(ElfSection {
                name,
                addr,
                offset,
                size,
                ty,
                flags,
            });
        }

        Ok(sections)
    }

    fn parse_segments(
        &self,
        data: &[u8],
        is_64bit: bool,
        ph_offset: u64,
    ) -> Result<Vec<ElfSegment>, String> {
        let mut segments = Vec::new();

        let eheader_idx = if is_64bit { 64 } else { 52 };
        if data.len() < eheader_idx {
            log::warn!("[Compiler] No program headers (truncated header)");
            return Ok(segments);
        }

        let ph_entsize = if is_64bit {
            u16::from_le_bytes(data[54..56].try_into().unwrap()) as u64
        } else {
            u16::from_le_bytes(data[42..44].try_into().unwrap()) as u64
        };

        let ph_num = if is_64bit {
            u16::from_le_bytes(data[56..58].try_into().unwrap()) as u64
        } else {
            u16::from_le_bytes(data[44..46].try_into().unwrap()) as u64
        };

        if ph_num == 0 || ph_entsize == 0 {
            log::info!("[Compiler] No program segments in ELF");
            return Ok(segments);
        }

        log::info!("[Compiler] Parsing {} program segments", ph_num);

        for i in 0..ph_num {
            let seg_offset = ph_offset + i * ph_entsize;
            let seg_size = if is_64bit { 56 } else { 32 };
            let seg_end = seg_offset + seg_size;
            if seg_end as usize > data.len() {
                log::warn!("[Compiler] Program segment {} truncated, skipping", i);
                break;
            }

            let (ty, offset, vaddr, filesz, memsz, flags) = if is_64bit {
                let ty = u32::from_le_bytes(
                    data[seg_offset as usize..(seg_offset + 4) as usize]
                        .try_into()
                        .unwrap(),
                );
                let offset = u64::from_le_bytes(
                    data[(seg_offset + 8) as usize..(seg_offset + 16) as usize]
                        .try_into()
                        .unwrap(),
                );
                let vaddr = u64::from_le_bytes(
                    data[(seg_offset + 16) as usize..(seg_offset + 24) as usize]
                        .try_into()
                        .unwrap(),
                );
                let filesz = u64::from_le_bytes(
                    data[(seg_offset + 32) as usize..(seg_offset + 40) as usize]
                        .try_into()
                        .unwrap(),
                );
                let memsz = u64::from_le_bytes(
                    data[(seg_offset + 40) as usize..(seg_offset + 48) as usize]
                        .try_into()
                        .unwrap(),
                );
                let flags = u32::from_le_bytes(
                    data[(seg_offset + 48) as usize..(seg_offset + 52) as usize]
                        .try_into()
                        .unwrap(),
                );
                (ty, offset, vaddr, filesz, memsz, flags)
            } else {
                let ty = u32::from_le_bytes(
                    data[seg_offset as usize..(seg_offset + 4) as usize]
                        .try_into()
                        .unwrap(),
                );
                let offset = u32::from_le_bytes(
                    data[(seg_offset + 4) as usize..(seg_offset + 8) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                let vaddr = u32::from_le_bytes(
                    data[(seg_offset + 8) as usize..(seg_offset + 12) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                let filesz = u32::from_le_bytes(
                    data[(seg_offset + 16) as usize..(seg_offset + 20) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                let memsz = u32::from_le_bytes(
                    data[(seg_offset + 20) as usize..(seg_offset + 24) as usize]
                        .try_into()
                        .unwrap(),
                ) as u64;
                let flags = u32::from_le_bytes(
                    data[(seg_offset + 24) as usize..(seg_offset + 28) as usize]
                        .try_into()
                        .unwrap(),
                );
                (ty, offset, vaddr, filesz, memsz, flags)
            };

            if ty == 1 {
                segments.push(ElfSegment {
                    ty,
                    offset,
                    vaddr,
                    filesz,
                    memsz,
                    flags,
                });
            }
        }

        Ok(segments)
    }

    /// Translate ELF to TVM bytecode
    fn translate_elf(&mut self, elf: &ElfBinary) {
        use super::disassembler::Disassembler;

        let code_sections: Vec<_> = elf.sections.iter().filter(|s| s.is_code()).collect();

        let data_sections: Vec<_> = elf
            .sections
            .iter()
            .filter(|s| s.is_data() || s.is_bss())
            .collect();

        if self.config.verbose {
            log::info!(
                "Found {} code sections, {} data sections",
                code_sections.len(),
                data_sections.len()
            );
        }

        // Entry point
        self.entry_point = 0;

        // Generate bootstrap code to set up the environment
        self.emit_opcode(Opcode::ENTER_PROT);

        // Find and translate code sections
        for section in code_sections {
            if section.offset as usize >= elf.data.len() {
                continue;
            }

            let end = (section.offset + section.size) as usize;
            if end > elf.data.len() {
                continue;
            }

            let section_data = &elf.data[section.offset as usize..end];

            if self.config.verbose {
                log::info!(
                    "Translating section at 0x{:x} ({} bytes)",
                    section.offset,
                    section.size
                );
            }

            // Disassemble and translate each instruction
            let mut disasm = Disassembler::new(section_data.to_vec(), section.addr);
            let decoded = disasm.decode_all();

            for inst in decoded {
                let ops = super::disassembler::translate_to_tvm(&inst);
                self.instructions.extend_from_slice(&ops);
            }
        }

        // Add data section to constant pool
        for section in data_sections {
            if section.offset as usize >= elf.data.len() {
                continue;
            }

            let end = (section.offset + section.size) as usize;
            if end > elf.data.len() {
                continue;
            }

            let data = &elf.data[section.offset as usize..end];
            self.add_data(data);
        }

        // Exit
        self.emit_opcode(Opcode::MOVI);
        self.emit_operand(0);
        self.emit_le32(0);

        self.emit_opcode(Opcode::SYSCALL);
        self.emit_operand(60); // exit syscall

        self.emit_opcode(Opcode::EXIT_PROT);
    }

    fn add_data(&mut self, data: &[u8]) {
        let offset = self.constants.len() as u32;
        self.constants.push(ConstantPoolEntry {
            offset,
            data: data.to_vec(),
            constant_type: ConstantType::Integer,
        });
    }

    /// Emit an opcode
    fn emit_opcode(&mut self, op: Opcode) {
        self.instructions.push(op as u8);
    }

    /// Emit a 32-bit value
    fn emit_le32(&mut self, val: u32) {
        self.instructions.extend_from_slice(&val.to_le_bytes());
    }

    /// Emit an 8-bit operand
    fn emit_operand(&mut self, val: u8) {
        self.instructions.push(val);
    }

    /// Build constant pool
    fn build_constant_pool(&self) -> Vec<u8> {
        let mut pool = Vec::new();
        for entry in &self.constants {
            pool.extend_from_slice(&entry.data);
        }
        pool
    }

    /// Add string to constant pool
    fn add_string(&mut self, s: &str) -> u32 {
        let offset = self.constants.len() as u32;
        self.constants.push(ConstantPoolEntry {
            offset,
            data: s.as_bytes().to_vec(),
            constant_type: ConstantType::String,
        });
        offset
    }

    /// Add integer to constant pool
    fn add_integer(&mut self, val: i32) -> u32 {
        let offset = self.constants.len() as u32;
        self.constants.push(ConstantPoolEntry {
            offset,
            data: val.to_le_bytes().to_vec(),
            constant_type: ConstantType::Integer,
        });
        offset
    }
}

/// Compile ELF to TVM bytecode (convenience function)
pub fn compile_elf(elf_data: &[u8], metadata: PackageMetadata) -> CompileResult {
    let mut compiler = Compiler::new_default();
    compiler.compile(elf_data, metadata)
}

/// Create a simple "Hello World" bytecode for testing
pub fn create_hello_world() -> CompileResult {
    let metadata = PackageMetadata {
        name: Some("hello".to_string()),
        version: Some("1.0.0".to_string()),
        entry: Some("main".to_string()),
        description: Some("Hello World demo".to_string()),
        author: Some("Trymon".to_string()),
        ..Default::default()
    };

    let mut compiler = Compiler::new_default();
    compiler.compile(
        b"\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x3e\x00",
        metadata,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hello_world_compile() {
        let result = create_hello_world();
        assert!(result.success);
    }
}
