//! Symbol Resolver
//!
//! Handles PLT/GOT symbol resolution for ELF binaries.

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Symbol {
    pub name: String,
    pub address: u64,
    pub size: u64,
    pub binding: SymbolBinding,
    pub symbol_type: SymbolType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolBinding {
    Local,
    Global,
    Weak,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolType {
    Notype,
    Object,
    Function,
    Section,
    File,
}

#[derive(Debug, Clone)]
pub struct SymbolTable {
    symbols: HashMap<String, Symbol>,
    addresses: HashMap<u64, String>,
}

impl SymbolTable {
    pub fn new() -> Self {
        Self {
            symbols: HashMap::new(),
            addresses: HashMap::new(),
        }
    }

    pub fn insert(&mut self, symbol: Symbol) {
        self.symbols.insert(symbol.name.clone(), symbol.clone());
        self.addresses.insert(symbol.address, symbol.name);
    }

    pub fn get_by_name(&self, name: &str) -> Option<&Symbol> {
        self.symbols.get(name)
    }

    pub fn get_by_address(&self, addr: u64) -> Option<&String> {
        self.addresses.get(&addr)
    }

    pub fn len(&self) -> usize {
        self.symbols.len()
    }
}

impl Default for SymbolTable {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct PLTEntry {
    pub address: u64,
    pub name: String,
    pub got_address: u64,
}

pub struct PLTResolver {
    plt_entries: Vec<PLTEntry>,
    got_entries: HashMap<u64, String>,
    resolved_stubs: HashMap<String, usize>,
}

impl PLTResolver {
    pub fn new() -> Self {
        Self {
            plt_entries: Vec::new(),
            got_entries: HashMap::new(),
            resolved_stubs: HashMap::new(),
        }
    }

    pub fn add_plt_entry(&mut self, address: u64, name: String, got_address: u64) {
        self.plt_entries.push(PLTEntry {
            address,
            name: name.clone(),
            got_address,
        });
        self.got_entries.insert(got_address, name);
    }

    pub fn resolve_symbol(&mut self, name: &str, stub_id: usize) {
        self.resolved_stubs.insert(name.to_string(), stub_id);
    }

    pub fn get_plt_entry(&self, address: u64) -> Option<&PLTEntry> {
        self.plt_entries.iter().find(|e| e.address == address)
    }

    pub fn get_got_name(&self, got_addr: u64) -> Option<&String> {
        self.got_entries.get(&got_addr)
    }

    pub fn is_resolved(&self, name: &str) -> bool {
        self.resolved_stubs.contains_key(name)
    }
}

impl Default for PLTResolver {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub enum LibcImpl {
    Syscall(u32),
    Custom(fn(&[u32]) -> i32),
    Stub,
}

#[derive(Debug, Clone)]
pub struct LibcFunction {
    pub name: String,
    pub syscall_number: Option<u32>,
    pub implementation: LibcImpl,
}

pub struct SymbolResolver {
    symbol_table: SymbolTable,
    plt_resolver: PLTResolver,
    libc_functions: HashMap<String, LibcFunction>,
    custom_resolvers: HashMap<String, ResolverCallback>,
}

type ResolverCallback = fn(&[u32]) -> i32;

impl SymbolResolver {
    pub fn new() -> Self {
        let mut resolver = Self {
            symbol_table: SymbolTable::new(),
            plt_resolver: PLTResolver::new(),
            libc_functions: HashMap::new(),
            custom_resolvers: HashMap::new(),
        };

        resolver.init_libc_functions();
        resolver
    }

    fn init_libc_functions(&mut self) {
        let funcs = vec![
            ("printf", Some(1), LibcImpl::Custom(Self::handle_printf)),
            ("scanf", Some(0), LibcImpl::Stub),
            ("malloc", Some(9), LibcImpl::Custom(Self::handle_malloc)),
            ("free", Some(9), LibcImpl::Custom(Self::handle_free)),
            ("calloc", Some(9), LibcImpl::Custom(Self::handle_calloc)),
            ("realloc", Some(9), LibcImpl::Custom(Self::handle_realloc)),
            ("memcpy", None, LibcImpl::Custom(Self::handle_memcpy)),
            ("memset", None, LibcImpl::Custom(Self::handle_memset)),
            ("memcmp", None, LibcImpl::Custom(Self::handle_memcmp)),
            ("strlen", None, LibcImpl::Custom(Self::handle_strlen)),
            ("strcpy", None, LibcImpl::Custom(Self::handle_strcpy)),
            ("strncpy", None, LibcImpl::Custom(Self::handle_strncpy)),
            ("strcmp", None, LibcImpl::Custom(Self::handle_strcmp)),
            ("strncmp", None, LibcImpl::Custom(Self::handle_strncmp)),
            ("strcat", None, LibcImpl::Custom(Self::handle_strcat)),
            ("strncat", None, LibcImpl::Custom(Self::handle_strncat)),
            ("fopen", Some(2), LibcImpl::Stub),
            ("fclose", Some(3), LibcImpl::Stub),
            ("fread", Some(0), LibcImpl::Stub),
            ("fwrite", Some(1), LibcImpl::Stub),
            ("exit", Some(60), LibcImpl::Syscall(60)),
            ("_exit", Some(60), LibcImpl::Syscall(60)),
            ("exit_group", Some(231), LibcImpl::Syscall(231)),
            ("getpid", Some(39), LibcImpl::Syscall(39)),
            ("getuid", Some(102), LibcImpl::Syscall(102)),
            ("getgid", Some(104), LibcImpl::Syscall(104)),
            ("geteuid", Some(107), LibcImpl::Syscall(107)),
            ("getegid", Some(108), LibcImpl::Syscall(108)),
            ("getcwd", Some(79), LibcImpl::Stub),
            ("chdir", Some(80), LibcImpl::Stub),
            ("open", Some(2), LibcImpl::Syscall(2)),
            ("close", Some(3), LibcImpl::Syscall(3)),
            ("read", Some(0), LibcImpl::Syscall(0)),
            ("write", Some(1), LibcImpl::Syscall(1)),
            ("lseek", Some(8), LibcImpl::Syscall(8)),
            ("stat", Some(4), LibcImpl::Stub),
            ("fstat", Some(5), LibcImpl::Stub),
            ("pipe", Some(22), LibcImpl::Stub),
            ("fork", Some(57), LibcImpl::Stub),
            ("wait", Some(61), LibcImpl::Stub),
            ("execve", Some(59), LibcImpl::Stub),
            ("unlink", Some(87), LibcImpl::Stub),
            ("sleep", Some(35), LibcImpl::Stub),
            ("time", Some(201), LibcImpl::Syscall(201)),
            ("clock_gettime", Some(113), LibcImpl::Stub),
            ("sysconf", Some(-1i32 as u32), LibcImpl::Stub),
        ];

        for (name, syscall, impl_type) in funcs {
            self.libc_functions.insert(
                name.to_string(),
                LibcFunction {
                    name: name.to_string(),
                    syscall_number: syscall,
                    implementation: impl_type,
                },
            );
        }
    }

    pub fn register_resolver(&mut self, name: String, callback: ResolverCallback) {
        self.custom_resolvers.insert(name, callback);
    }

    pub fn resolve(&self, name: &str) -> Option<&LibcFunction> {
        self.libc_functions.get(name).or_else(|| {
            self.custom_resolvers.get(name).map(|_| {
                let func = LibcFunction {
                    name: name.to_string(),
                    syscall_number: None,
                    implementation: LibcImpl::Stub,
                };
                Box::leak(Box::new(func)) as &LibcFunction
            })
        })
    }

    pub fn is_plt_entry(&self, addr: u64) -> bool {
        self.plt_resolver.get_plt_entry(addr).is_some()
    }

    fn handle_printf(args: &[u32]) -> i32 {
        log::debug!("printf called with {} args", args.len());
        0
    }

    fn handle_malloc(args: &[u32]) -> i32 {
        log::debug!("malloc called with size: {}", args[0]);
        0
    }

    fn handle_free(args: &[u32]) -> i32 {
        log::debug!("free called with ptr: {}", args[0]);
        0
    }

    fn handle_calloc(args: &[u32]) -> i32 {
        log::debug!("calloc called");
        0
    }

    fn handle_realloc(args: &[u32]) -> i32 {
        log::debug!("realloc called");
        0
    }

    fn handle_memcpy(args: &[u32]) -> i32 {
        log::debug!("memcpy called");
        0
    }

    fn handle_memset(args: &[u32]) -> i32 {
        log::debug!("memset called");
        0
    }

    fn handle_memcmp(args: &[u32]) -> i32 {
        log::debug!("memcmp called");
        0
    }

    fn handle_strlen(args: &[u32]) -> i32 {
        log::debug!("strlen called with ptr: {}", args[0]);
        0
    }

    fn handle_strcpy(args: &[u32]) -> i32 {
        log::debug!("strcpy called");
        0
    }

    fn handle_strncpy(args: &[u32]) -> i32 {
        log::debug!("strncpy called");
        0
    }

    fn handle_strcmp(args: &[u32]) -> i32 {
        log::debug!("strcmp called");
        0
    }

    fn handle_strncmp(args: &[u32]) -> i32 {
        log::debug!("strncmp called");
        0
    }

    fn handle_strcat(args: &[u32]) -> i32 {
        log::debug!("strcat called");
        0
    }

    fn handle_strncat(args: &[u32]) -> i32 {
        log::debug!("strncat called");
        0
    }
}

impl Default for SymbolResolver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_libc_resolution() {
        let resolver = SymbolResolver::new();

        let printf = resolver.resolve("printf");
        assert!(printf.is_some());
        assert_eq!(printf.unwrap().name, "printf");
    }

    #[test]
    fn test_unknown_symbol() {
        let resolver = SymbolResolver::new();

        let unknown = resolver.resolve("unknown_function");
        assert!(unknown.is_none());
    }
}
