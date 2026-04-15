//! TVM (Trymon Virtual Machine) Module
//!
//! Core virtualization layer for executing .trymon bytecode packages.
//! Provides interpreter, memory management, and syscall bridge.

pub mod appimage_extractor;
pub mod bytecode;
pub mod compiler;
pub mod disassembler;
pub mod interpreter;
pub mod libc_emulator;
pub mod memory;
pub mod packager;
pub mod sandbox;
pub mod symbol_resolver;
pub mod syscalls;
pub mod vm;

pub use appimage_extractor::*;
pub use bytecode::*;
pub use compiler::*;
pub use disassembler::*;
pub use interpreter::*;
pub use libc_emulator::*;
pub use memory::*;
pub use packager::*;
pub use sandbox::*;
pub use symbol_resolver::*;
pub use syscalls::*;
pub use vm::*;
