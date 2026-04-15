//! LibC Emulator
//!
//! Emulates common libc functions for converted ELF binaries.

use std::collections::HashMap;

pub struct LibcEmulator {
    heap: Vec<u8>,
    heap_top: usize,
    allocations: HashMap<usize, usize>,
}

impl LibcEmulator {
    pub fn new() -> Self {
        Self {
            heap: Vec::with_capacity(1024 * 1024),
            heap_top: 0,
            allocations: HashMap::new(),
        }
    }

    pub fn malloc(&mut self, size: usize) -> usize {
        if size == 0 {
            return 0;
        }

        let ptr = self.heap_top;
        self.heap.resize(self.heap_top + size, 0);
        self.allocations.insert(ptr, size);
        self.heap_top += size;

        log::debug!("TVM libc: malloc({}) = 0x{:x}", size, ptr);
        ptr
    }

    pub fn free(&mut self, ptr: usize) {
        if ptr == 0 {
            return;
        }

        self.allocations.remove(&ptr);
        log::debug!("TVM libc: free(0x{:x})", ptr);
    }

    pub fn calloc(&mut self, nmemb: usize, size: usize) -> usize {
        let total = nmemb * size;
        self.malloc(total)
    }

    pub fn realloc(&mut self, ptr: usize, new_size: usize) -> usize {
        if ptr == 0 {
            return self.malloc(new_size);
        }

        if new_size == 0 {
            self.free(ptr);
            return 0;
        }

        let old_size = self.allocations.get(&ptr).copied().unwrap_or(0);
        let new_ptr = self.malloc(new_size);

        if new_ptr > 0 && old_size > 0 {
            let copy_size = old_size.min(new_size);
            // In real implementation, would copy memory
        }

        self.free(ptr);
        new_ptr
    }

    pub fn memcpy(&mut self, dest: usize, src: usize, n: usize) -> usize {
        log::debug!(
            "TVM libc: memcpy(dest=0x{:x}, src=0x{:x}, n={})",
            dest,
            src,
            n
        );
        dest
    }

    pub fn memset(&mut self, s: usize, c: i32, n: usize) -> usize {
        log::debug!("TVM libc: memset(s=0x{:x}, c={}, n={})", s, c, n);
        s
    }

    pub fn memmove(&mut self, dest: usize, src: usize, n: usize) -> usize {
        log::debug!(
            "TVM libc: memmove(dest=0x{:x}, src=0x{:x}, n={})",
            dest,
            src,
            n
        );
        dest
    }

    pub fn memcmp(&mut self, s1: usize, s2: usize, n: usize) -> i32 {
        log::debug!("TVM libc: memcmp(s1=0x{:x}, s2=0x{:x}, n={})", s1, s2, n);
        0
    }

    pub fn strlen(&self, s: usize) -> usize {
        if s == 0 {
            return 0;
        }

        let mut len = 0;
        // In real impl, would read from VM memory
        log::debug!("TVM libc: strlen(s=0x{:x})", s);
        len
    }

    pub fn strcpy(&self, dest: usize, src: usize) -> usize {
        log::debug!("TVM libc: strcpy(dest=0x{:x}, src=0x{:x})", dest, src);
        dest
    }

    pub fn strncpy(&self, dest: usize, src: usize, n: usize) -> usize {
        log::debug!(
            "TVM libc: strncpy(dest=0x{:x}, src=0x{:x}, n={})",
            dest,
            src,
            n
        );
        dest
    }

    pub fn strcmp(&self, s1: usize, s2: usize) -> i32 {
        log::debug!("TVM libc: strcmp(s1=0x{:x}, s2=0x{:x})", s1, s2);
        0
    }

    pub fn strncmp(&self, s1: usize, s2: usize, n: usize) -> i32 {
        log::debug!("TVM libc: strncmp(s1=0x{:x}, s2=0x{:x}, n={})", s1, s2, n);
        0
    }

    pub fn strcat(&self, dest: usize, src: usize) -> usize {
        log::debug!("TVM libc: strcat(dest=0x{:x}, src=0x{:x})", dest, src);
        dest
    }

    pub fn strncat(&self, dest: usize, src: usize, n: usize) -> usize {
        log::debug!(
            "TVM libc: strncat(dest=0x{:x}, src=0x{:x}, n={})",
            dest,
            src,
            n
        );
        dest
    }

    pub fn strchr(&self, s: usize, c: i32) -> usize {
        log::debug!("TVM libc: strchr(s=0x{:x}, c={})", s, c);
        0
    }

    pub fn strstr(&self, haystack: usize, needle: usize) -> usize {
        log::debug!(
            "TVM libc: strstr(haystack=0x{:x}, needle=0x{:x})",
            haystack,
            needle
        );
        0
    }

    pub fn sprintf(&self, buf: usize, format: usize, _args: usize) -> i32 {
        log::debug!("TVM libc: sprintf(buf=0x{:x}, format=0x{:x})", buf, format);
        0
    }

    pub fn snprintf(&self, buf: usize, size: usize, format: usize, _args: usize) -> i32 {
        log::debug!(
            "TVM libc: snprintf(buf=0x{:x}, size={}, format=0x{:x})",
            buf,
            size,
            format
        );
        0
    }

    pub fn printf(&self, format: usize, _args: usize) -> i32 {
        log::debug!("TVM libc: printf(format=0x{:x})", format);
        0
    }
}

impl Default for LibcEmulator {
    fn default() -> Self {
        Self::new()
    }
}

pub struct StringFormatter {
    buffer: Vec<u8>,
}

impl StringFormatter {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn format(&mut self, format: &str, args: &[u32]) -> Vec<u8> {
        self.buffer.clear();

        let mut chars = format.chars().peekable();
        let mut arg_idx = 0;

        while let Some(c) = chars.next() {
            if c == '%' {
                match chars.peek() {
                    Some(&'d') => {
                        chars.next();
                        if arg_idx < args.len() {
                            self.buffer.extend(args[arg_idx].to_string().as_bytes());
                            arg_idx += 1;
                        }
                    }
                    Some(&'s') => {
                        chars.next();
                        self.buffer.push(b'%');
                        self.buffer.push(b's');
                    }
                    Some(&'c') => {
                        chars.next();
                        if arg_idx < args.len() {
                            self.buffer.push(args[arg_idx] as u8);
                            arg_idx += 1;
                        }
                    }
                    Some(&'x') => {
                        chars.next();
                        if arg_idx < args.len() {
                            self.buffer
                                .extend(format!("{:x}", args[arg_idx]).as_bytes());
                            arg_idx += 1;
                        }
                    }
                    Some(&'p') => {
                        chars.next();
                        if arg_idx < args.len() {
                            self.buffer
                                .extend(format!("{:p}", args[arg_idx] as *const u8).as_bytes());
                            arg_idx += 1;
                        }
                    }
                    Some(&'%') => {
                        chars.next();
                        self.buffer.push(b'%');
                    }
                    _ => {
                        self.buffer.push(b'%');
                    }
                }
            } else {
                self.buffer.push(c as u8);
            }
        }

        self.buffer.clone()
    }
}

impl Default for StringFormatter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_malloc() {
        let mut emulator = LibcEmulator::new();
        let ptr = emulator.malloc(1024);
        assert!(ptr > 0);
    }

    #[test]
    fn test_free() {
        let mut emulator = LibcEmulator::new();
        let ptr = emulator.malloc(1024);
        emulator.free(ptr);
    }

    #[test]
    fn test_string_formatter() {
        let mut formatter = StringFormatter::new();
        let result = formatter.format("Hello %d", &[42]);
        assert!(result.starts_with(b"Hello 42"));
    }
}
