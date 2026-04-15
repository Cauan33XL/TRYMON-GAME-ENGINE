# Trymon OS

**Trymon OS** is a high-performance web platform that executes native Linux binaries directly in the browser. It combines WebAssembly-based virtualization with a native Rust kernel to create a full-featured operating system simulation running entirely in the browser.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Features](#key-features)
4. [TVM - Trymon Virtual Machine](#tvm---trymon-virtual-machine)
5. [Getting Started](#getting-started)
6. [Technical Details](#technical-details)
7. [Project Structure](#project-structure)
8. [Development](#development)
9. [Roadmap](#roadmap)
10. [License](#license)

---

## Overview

Trymon bridges the gap between native software and the web by providing a **Binary-as-a-Service** environment. Users can:

- Execute unmodified Linux binaries (`.AppImage`, `.deb`, `.rpm`, `.trymon`)
- Use a full desktop interface (Trymon OS) with window management
- Install and run applications persistently
- Collaborate in real-time with remote sessions

The platform is built on three core pillars:

1. **Virtualization**: x86 emulation via v86 + TVM bytecode execution
2. **Kernel**: Rust-based kernel managing processes, VFS, and syscalls
3. **Interface**: React-based desktop with window manager, taskbar, and system apps

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Trymon OS (Frontend)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Window     │  │ Taskbar     │  │ System      │  │ Desktop   │  │
│  │ Manager    │  │             │  │ Apps        │  │ Icons     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Kernel Service (WASM)                            │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                    Rust Kernel (kernel-rust)                   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │   │
│  │  │ Process  │  │ Virtual  │  │ Binary   │  │ TrymonEngine │   │   │
│  │  │ Manager  │  │ FS       │  │ Loader   │  │ (TVM + Apps) │   │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │   │
│  │                                                               │   │
│  │  ┌─────────────────────────────────────────────────────────┐ │   │
│  │  │           TVM - Trymon Virtual Machine                   │ │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────┐  │ │   │
│  │  │  │ Bytecode│ │Interpreter│ │Syscall   │ │  Sandbox    │  │ │   │
│  │  │  │ Format  │ │           │ │  Bridge  │ │  Security   │  │ │   │
│  │  │  └─────────┘ └──────────┘ └──────────┘ └──────────────┘  │ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Emulation Layer                              │
│  ┌─────────────────────────┐     ┌────────────────────────────────┐  │
│  │     v86 Emulator       │     │    TVM Bytecode Executor       │  │
│  │   (x86 emulation)      │     │   (.trymon package execution)  │  │
│  └─────────────────────────┘     └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend** | React + TypeScript | Desktop UI, window management, system apps |
| **Kernel** | Rust + WASM | Process management, VFS, binary loading |
| **TVM** | Rust + WASM | Bytecode interpreter for .trymon packages |
| **Emulation** | v86 | x86 emulator for legacy binary execution |
| **Storage** | IndexedDB | Persistent VFS state in browser |

---

## Key Features

### Trymon OS Desktop
- Full window management (drag, resize, minimize, maximize)
- Taskbar with application icons
- Start menu with app launcher
- System tray with clock and notifications

### Binary Management
- **Upload**: Drag & drop or file picker for `.appimage`, `.deb`, `.rpm`, `.trymon`
- **Install**: Install packages to VFS for persistent use
- **Execute**: Run packages directly via TVM

### Trymon Apps
- Installed apps appear on desktop as icons
- Click to execute via TVM
- Persistent across browser sessions

### System Monitor
- Real-time CPU and memory usage
- Process list
- TVM status (active/error)
- VFS statistics

### Session Sync (Trymon Remote)
- Real-time cursor sharing
- Collaborative window management
- P2P connection via PeerJS

---

## TVM - Trymon Virtual Machine

TVM is the core virtualization layer that makes the TVM concept work:

### What is TVM?

TVM (Trymon Virtual Machine) is a **bytecode interpreter** that:
1. **Loads** `.trymon` packages (TVM bytecode format)
2. **Executes** in a sandboxed environment
3. **Translates** Linux syscalls to browser APIs

### Bytecode Format

```
┌────────────────────────────────────────────────────────────┐
│ TVM Bytecode (.trymon v2)                                  │
├────────────────────────────────────────────────────────────┤
│ Header: Magic "TVM1", Version, Flags, Entry Point          │
├────────────────────────────────────────────────────────────┤
│ Instructions: ~50 opcodes (stack, arithmetic, memory,     │
│               control, syscalls)                           │
├────────────────────────────────────────────────────────────┤
│ Constants Pool: strings, numbers, embedded data             │
├────────────────────────────────────────────────────────────┤
│ Metadata: name, version, entry, dependencies, permissions │
└────────────────────────────────────────────────────────────┘
```

### Supported Opcodes

- **Stack**: PUSH, POP, DUP, SWAP, ROT
- **Arithmetic**: ADD, SUB, MUL, DIV, MOD, NEG, INC, DEC
- **Bitwise**: AND, OR, XOR, NOT, SHL, SHR
- **Comparison**: CMP_EQ, CMP_NE, CMP_LT, CMP_GT, CMP_LE, CMP_GE
- **Memory**: LOAD, STORE, ALLOC, FREE
- **Control**: JMP, JZ, JNZ, CALL, RET, HALT
- **Syscalls**: SYSCALL (Linux syscall bridge)

### Syscall Bridge

TVM translates Linux syscalls to browser equivalents:

| Linux Syscall | Browser/WASM Equivalent |
|---------------|-------------------------|
| read(fd, buf, n) | stdin / VFS read |
| write(fd, buf, n) | stdout/stderr → UI |
| open(path, flags) | VFS file lookup |
| brk(addr) | WASM memory grow |
| exit(code) | Process termination |
| getpid() | Internal PID |
| getcwd() | VFS current directory |
| time() | `performance.now()` |

### Sandbox Security

TVM includes a security sandbox with:
- **Syscall whitelist**: Only approved syscalls allowed
- **Memory bounds**: Address validation
- **Resource limits**: Max memory, instructions/second, call depth

### Package Modes

| Mode | Behavior | Result |
|------|----------|--------|
| **Execute** | Load bytecode → Run → Exit | Console output |
| **Install** | Save to VFS `/trymon/<id>` | Desktop icon |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Rust (for kernel development)
- wasm-pack (`cargo install wasm-pack`)

### Installation

```bash
# Clone the repository
git clone https://github.com/trymon/trymon-binary-engine.git
cd trymon-binary-engine

# Install dependencies
npm install

# Build the Rust kernel (WASM)
cd src/kernel-rust
wasm-pack build --target web --out-dir ../wasm/pkg

# Return to root and build frontend
cd ../..
npm run build
```

### Development

```bash
# Start development server
npm run dev

# Open http://localhost:5173
```

### Production Build

```bash
npm run build
# Output: dist/
```

---

## Technical Details

### Build Outputs

| File | Size | Description |
|------|------|-------------|
| `trymon_kernel_rust.wasm` | ~460 KB | Rust kernel + TVM |
| `main.js` | ~408 KB | React frontend |
| `main.css` | ~48 KB | Styles |

### Memory Configuration

- **WASM Memory**: 64MB default
- **VFS Storage**: IndexedDB (persistent)
- **Stack Size**: 64KB per execution context

### Supported Binary Formats

| Format | Support | Method |
|--------|---------|--------|
| `.trymon` (v2) | ✅ Full | TVM bytecode |
| `.trymon` (v1) | ✅ Legacy | ELF embedding |
| `.AppImage` | ⚠️ Basic | v86 emulation |
| `.deb` | ⚠️ Basic | v86 emulation |
| `.rpm` | ⚠️ Basic | v86 emulation |
| ELF | ⚠️ Basic | v86 emulation |

---

## Project Structure

```
trymon-binary-engine/
├── src/
│   ├── kernel-rust/           # Rust kernel (WASM)
│   │   ├── src/
│   │   │   ├── lib.rs         # Main entry + WASM exports
│   │   │   ├── tvm/           # TVM module
│   │   │   │   ├── mod.rs
│   │   │   │   ├── bytecode.rs # Bytecode format + opcodes
│   │   │   │   ├── vm.rs       # Virtual machine
│   │   │   │   ├── memory.rs   # Memory manager
│   │   │   │   ├── interpreter.rs # High-level API
│   │   │   │   ├── compiler.rs # ELF → TVM compiler
│   │   │   │   ├── syscalls.rs # Syscall bridge
│   │   │   │   └── sandbox.rs  # Security sandbox
│   │   │   ├── trymon_engine.rs  # App management
│   │   │   ├── process_manager.rs
│   │   │   ├── virtual_fs.rs
│   │   │   ├── binary_loader.rs
│   │   │   └── ...
│   │   └── Cargo.toml
│   │
│   ├── abstract-software-trymon/  # React apps
│   │   └── applications-trymon/
│   │       ├── BinariesApp.tsx
│   │       ├── MonitorApp.tsx
│   │       ├── TerminalApp.tsx
│   │       └── ...
│   │
│   ├── interface/              # Main React app
│   │   ├── App.tsx
│   │   ├── hooks/
│   │   ├── services/
│   │   └── style.css
│   │
│   └── wasm/                  # WASM output
│       └── pkg/
│
├── public/                    # Static assets
├── dist/                      # Production build
├── package.json
├── vite.config.ts
└── README.md
```

---

## Development

### Adding a New TVM Opcode

1. Add opcode to `src/kernel-rust/src/tvm/bytecode.rs`:
   ```rust
   pub enum Opcode {
       // ... existing
       MY_NEW_OP = 0xF0,
   }
   ```

2. Implement in `src/kernel-rust/src/tvm/vm.rs`:
   ```rust
   Opcode::MY_NEW_OP => {
       // implementation
   }
   ```

3. Rebuild:
   ```bash
   cd src/kernel-rust && wasm-pack build --target web --out-dir ../wasm/pkg
   ```

### Creating a .trymon Package

```bash
# Package format (v2):
# [4] Magic: "TRYM"
# [1] Version: 0x02
# [2] Flags
# [4] Metadata Length
# [N] Metadata JSON
# [4] Code Length
# [N] TVM Bytecode
```

---

## Roadmap

### Completed ✅

- [x] Trymon OS desktop interface
- [x] Window management system
- [x] Process manager
- [x] Virtual file system (VFS)
- [x] Binary loader (.AppImage, .deb, .rpm)
- [x] TVM core implementation
- [x] TVM bytecode format
- [x] Syscall bridge (Linux → browser)
- [x] Sandbox security
- [x] .trymon package support (v2)
- [x] Execute/Install modes
- [x] Auto-start TVM at boot

### In Progress 🚧

- [ ] TVM compiler (ELF → .trymon)
- [ ] Full syscall implementation
- [ ] Network support in TVM
- [ ] Sound support

### Future 📋

- [ ] Trymon Store (app marketplace)
- [ ] BrowserApp integration
- [ ] Mobile support
- [ ] PWA capabilities

---

## License

**GPL-3.0** - GNU General Public License v3.0

This project is open source. You are free to use, modify, and distribute it under the terms of the GPL-3.0 license.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## Support

For issues and questions:
- GitHub Issues: https://github.com/trymon/trymon-binary-engine/issues
- Documentation: https://docs.trymon.dev

---

# Technical Reference Guide

This section provides detailed technical information for developers who want to understand or extend Trymon.

---

## WASM API Reference

### Kernel Functions

The Rust kernel exposes the following functions to JavaScript:

```typescript
// Initialization
kernel.api_kernel_init(config: string): void
kernel.api_get_status(): string
kernel.api_tick(): void

// Binary Management
kernel.api_load_binary(name: string, data: Uint8Array): string
kernel.api_remove_binary(id: string): void
kernel.api_execute_binary(id: string, args: string): string

// VFS Operations
kernel.kernel_export_vfs(): string
kernel.kernel_import_vfs(json: string): void

// Trymon Apps
kernel.kernel_trymon_install(binaryId: string): string
kernel.kernel_trymon_list_apps(): string
kernel.kernel_trymon_run_app(appId: string): string

// TVM Functions
kernel.tvm_init(): void
kernel.tvm_load(data: Uint8Array): string
kernel.tvm_execute(packageId: string): string
kernel.tvm_compile_elf(elfData: Uint8Array, name: string): string
kernel.tvm_sandbox_status(): string
```

### Return Types

- `api_get_status()` returns JSON:
```json
{
  "initialized": true,
  "uptime": 3600,
  "loaded_binaries": [],
  "running_processes": [],
  "memory_usage_bytes": 4194304,
  "filesystem_stats": {
    "total_files": 42,
    "total_size_bytes": 1048576
  },
  "state": "Running",
  "boot_logs": []
}
```

- `kernel_trymon_list_apps()` returns JSON:
```json
[
  {
    "id": "uuid-string",
    "name": "MyApp",
    "version": "1.0.0",
    "install_path": "/trymon/uuid-string",
    "entry_point": "main.tvm",
    "status": "Installed"
  }
]
```

- `tvm_execute()` returns JSON:
```json
{
  "success": true,
  "exit_code": 0,
  "stdout": "Hello, World!\n",
  "stderr": "",
  "stats": {
    "instructions_executed": 1523,
    "function_calls": 42,
    "syscall_count": 15,
    "allocations": 3,
    "cycles": 1523
  }
}
```

---

## TVM Bytecode Specification

### File Format (.trymon v2)

```
Offset  Size  Description
------  ----  -----------
0x00    4     Magic: "TRYM"
0x04    1     Version: 0x02
0x05    2     Flags (bit0=executable, bit1=installable)
0x07    4     Metadata Length (LE)
0x0B    N     Metadata JSON
0x0B+N  4     Code Length (LE)
0x0F+N  M     TVM Bytecode
```

### Metadata JSON Schema

```json
{
  "name": "myapp",
  "version": "1.0.0",
  "entry": "main",
  "description": "My Application",
  "author": "Developer Name",
  "icon": "base64_encoded_png",
  "dependencies": ["libgtk", "libglib"],
  "permissions": ["filesystem", "network"]
}
```

### Instruction Encoding

TVM uses a variable-length instruction format:

```
[1 byte opcode] [0-5 bytes operands]
```

Example instructions:
- `PUSH_IMM32`: `01 [4 bytes value]` - Push 32-bit immediate
- `JMP`: `50 [4 bytes offset]` - Jump to offset
- `SYSCALL`: `70 [1 byte syscall_num]` - System call
- `HALT`: `58 [4 bytes exit_code]` - Exit with code

### Register File

TVM provides 13 registers:

| Register | Description |
|----------|-------------|
| R0-R7 | General purpose |
| SP | Stack pointer |
| BP | Base pointer |
| PC | Program counter |
| FLAGS | Condition flags |
| SYS | Reserved for system |

---

## Syscall Numbers (Linux x86_64 Compatible)

| Number | Name | Description |
|--------|------|-------------|
| 0 | read | Read from file descriptor |
| 1 | write | Write to file descriptor |
| 2 | open | Open file |
| 3 | close | Close file descriptor |
| 9 | mmap | Map memory |
| 10 | mprotect | Set memory protection |
| 11 | munmap | Unmap memory |
| 12 | brk | Change data segment size |
| 60 | exit | Terminate process |
| 79 | getcwd | Get current working directory |
| 96 | gettimeofday | Get time |
| 231 | exit_group | Exit all threads |
| 257 | openat | Open file relative to directory |

---

## VFS (Virtual File System)

### Directory Structure

```
/
├── apps/              # Installed Trymon apps
│   └── <app-id>/
│       └── main
├── trymon/            # TVM bytecode packages
│   └── <app-id>/
│       └── main.tvm
├── bin/               # System binaries
├── etc/               # System configuration
├── home/              # User home directory
│   └── user/
├── usr/               # User programs
│   ├── bin/
│   └── lib/
├── tmp/               # Temporary files
└── var/               # Variable data
```

### File Operations

```typescript
// Create directory
vfs.createDirectory(path: string): void

// Write file
vfs.writeFile(path: string, data: Uint8Array): void

// Read file
vfs.readFile(path: string): Uint8Array | null

// Delete
vfs.delete(path: string): boolean

// List directory
vfs.listDirectory(path: string): string[]
```

### Persistence

VFS state is automatically saved to IndexedDB every 5 seconds and restored on page load.

---

## Process Manager

### Process States

- **Created**: Process initialized but not started
- **Running**: Actively executing
- **Blocked**: Waiting for I/O
- **Terminated**: Finished execution

### Process Info Structure

```json
{
  "pid": 1,
  "name": "bash",
  "status": "Running",
  "cpu_usage": 0.05,
  "memory_usage": 2097152,
  "start_time": 1699999999999,
  "parent_pid": 0
}
```

---

## Security Model

### Sandbox Configuration

```rust
SandboxConfig {
    enable_syscall_whitelist: true,     // Only allow listed syscalls
    enable_memory_bounds: true,        // Validate memory access
    enable_resource_limits: true,      // Enforce limits
    max_memory: 64 * 1024 * 1024,     // 64MB
    max_instructions_per_second: 1_000_000,
    max_syscalls_per_second: 10_000,
    max_call_depth: 256,
    allowed_network_domains: [],       // Empty = no network
}
```

### Allowed Syscalls

Only these syscalls are permitted:
`read, write, open, close, mmap, mprotect, munmap, brk, access, exit, getdents, getcwd, chdir, gettimeofday, getrlimit, getuid, getgid, geteuid, getegid, exit_group, openat`

---

## Performance Considerations

### Memory Usage

- **WASM Heap**: 64MB default (configurable)
- **Per-Execution Stack**: 64KB
- **VFS Storage**: Up to IndexedDB limits (~50MB typically)

### Optimization Tips

1. **Use .trymon packages**: Native TVM execution is faster than v86 emulation
2. **Minimize syscalls**: Batch I/O operations when possible
3. **Limit concurrent processes**: Too many processes impact performance

### Known Limitations

- No sound support yet
- Limited network functionality
- v86 emulation is slower than native execution

---

## Testing

### Unit Tests

```bash
# Run Rust tests
cd src/kernel-rust
cargo test
```

### Integration Tests

```bash
# Build and test in browser
npm run build
# Serve dist/ and open in browser
```

---

## Build Configuration

### Vite Configuration

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        }
      }
    }
  }
})
```

### Rust Build Profile

```toml
# Cargo.toml [profile.release]
opt-level = "s"      # Optimize for size
lto = true           # Link-time optimization
codegen-units = 1    # Better optimization
panic = "unwind"     # Better error messages
```

---

## Credits

- **v86**: https://github.com/copy/v86 - x86 emulator
- **Rust**: https://www.rust-lang.org/ - Systems programming
- **React**: https://react.dev/ - UI framework
- **WASM**: https://webassembly.org/ - Binary format

---

**Trymon OS** - Bringing native Linux binaries to the web.