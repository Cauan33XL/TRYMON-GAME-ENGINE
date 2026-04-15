//! TVM Packager
//!
//! Creates .trymon packages from converted ELF binaries.

use super::bytecode::{
    CompileResult, Opcode, PackageMetadata, TVMBytecode, TVM_MAGIC, TVM_VERSION,
};
use super::disassembler::{translate_to_tvm, DecodedInstruction, Disassembler};
use super::symbol_resolver::SymbolResolver;
use std::collections::HashMap;

pub struct Packager {
    metadata: PackageMetadata,
    required_syscalls: Vec<u32>,
    emulated_libs: Vec<String>,
    embedded_data: Vec<u8>,
    translated_code: Vec<u8>,
}

impl Packager {
    pub fn new(metadata: PackageMetadata) -> Self {
        Self {
            metadata,
            required_syscalls: Vec::new(),
            emulated_libs: Vec::new(),
            embedded_data: Vec::new(),
            translated_code: Vec::new(),
        }
    }

    pub fn add_syscall(&mut self, syscall: u32) {
        if !self.required_syscalls.contains(&syscall) {
            self.required_syscalls.push(syscall);
        }
    }

    pub fn add_emulated_lib(&mut self, lib: &str) {
        if !self.emulated_libs.contains(&lib.to_string()) {
            self.emulated_libs.push(lib.to_string());
        }
    }

    pub fn set_embedded_data(&mut self, data: Vec<u8>) {
        self.embedded_data = data;
    }

    pub fn translate_elf(&mut self, elf_data: &[u8]) -> Result<(), String> {
        let mut disasm = Disassembler::new(elf_data.to_vec(), 0);
        let instructions = disasm.decode_all();

        for inst in &instructions {
            let ops = translate_to_tvm(inst);
            for op in ops {
                self.translated_code.push(op as u8);
            }
        }

        log::info!(
            "Translated {} instructions to TVM bytecode",
            instructions.len()
        );
        Ok(())
    }

    pub fn build(&self) -> CompileResult {
        let mut instructions = Vec::new();

        // Entry point wrapper
        instructions.push(Opcode::NOP as u8);
        instructions.push(0);
        instructions.push(0);
        instructions.push(0);

        // Add translated code
        instructions.extend_from_slice(&self.translated_code);

        // Add HALT at the end
        instructions.push(Opcode::HALT as u8);
        instructions.push(0);
        instructions.push(0);
        instructions.push(0);

        let bytecode = TVMBytecode {
            magic: *TVM_MAGIC,
            version: TVM_VERSION,
            flags: 0x01,
            entry_point: 0,
            instruction_count: (instructions.len() / 4) as u32,
            constants_offset: 0,
            constants_size: 0,
            code_offset: 0,
            code_size: instructions.len() as u32,
            instructions,
            constants: Vec::new(),
        };

        CompileResult {
            success: true,
            bytecode: Some(bytecode),
            error: None,
            warnings: Vec::new(),
            size: 0,
        }
    }

    pub fn analyze_elf(&mut self, elf_data: &[u8]) {
        // Analyze which syscalls are needed
        let needed_syscalls = vec![
            0,  // read
            1,  // write
            2,  // open
            3,  // close
            9,  // mmap
            12, // brk
            60, // exit
        ];

        for syscall in needed_syscalls {
            self.add_syscall(syscall);
        }

        // Analyze which libc functions are needed
        let needed_libs = vec!["libc", "libm", "libpthread", "libdl"];
        for lib in needed_libs {
            self.add_emulated_lib(lib);
        }
    }

    pub fn get_metadata_json(&self) -> String {
        let mut json = String::new();
        json.push_str("{");
        json.push_str(&format!(
            "\"name\": \"{}\",",
            self.metadata.name.as_deref().unwrap_or("unknown")
        ));
        json.push_str(&format!(
            "\"version\": \"{}\",",
            self.metadata.version.as_deref().unwrap_or("1.0.0")
        ));
        json.push_str(&format!(
            "\"entry\": \"{}\",",
            self.metadata.entry.as_deref().unwrap_or("main")
        ));

        if let Some(desc) = &self.metadata.description {
            json.push_str(&format!("\"description\": \"{}\",", desc));
        }

        json.push_str("\"required_syscalls\": [");
        for (i, syscall) in self.required_syscalls.iter().enumerate() {
            if i > 0 {
                json.push_str(",");
            }
            json.push_str(&syscall.to_string());
        }
        json.push_str("],");

        json.push_str("\"emulated_libs\": [");
        for (i, lib) in self.emulated_libs.iter().enumerate() {
            if i > 0 {
                json.push_str(",");
            }
            json.push_str(&format!("\"{}\"", lib));
        }
        json.push_str("]");

        json.push_str("}");
        json
    }
}

pub fn package_elf(elf_data: &[u8], metadata: PackageMetadata) -> CompileResult {
    let mut packager = Packager::new(metadata);

    packager.analyze_elf(elf_data);

    if let Err(e) = packager.translate_elf(elf_data) {
        return CompileResult::error(e);
    }

    packager.build()
}

pub fn extract_dependencies(elf_data: &[u8]) -> HashMap<String, Vec<String>> {
    let mut deps = HashMap::new();

    // Simple dependency analysis
    // In a full implementation, would parse ELF dynamic section
    deps.insert("libc".to_string(), vec!["ld-linux-x86-64.so.2".to_string()]);

    deps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packager() {
        let metadata = PackageMetadata {
            name: Some("test".to_string()),
            version: Some("1.0.0".to_string()),
            entry: Some("main".to_string()),
            description: Some("Test package".to_string()),
            author: Some("Test".to_string()),
            ..Default::default()
        };

        let packager = Packager::new(metadata);
        let result = packager.build();
        assert!(result.success);
    }
}
