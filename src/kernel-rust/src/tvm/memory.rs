//! TVM Memory Manager
//!
//! Handles memory allocation, deallocation, and bounds checking for the TVM.

use std::collections::HashMap;

/// Default memory limit (64MB)
pub const DEFAULT_MEMORY_LIMIT: usize = 64 * 1024 * 1024;

/// Initial heap size (1MB)
pub const DEFAULT_HEAP_SIZE: usize = 1024 * 1024;

/// Stack size per execution context (64KB)
pub const DEFAULT_STACK_SIZE: usize = 64 * 1024;

/// Memory region types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryRegion {
    /// Code segment (read-only)
    Code,
    /// Static data (read-only)
    Static,
    /// Heap (read-write)
    Heap,
    /// Stack (read-write, grows down)
    Stack,
    /// Custom memory region
    Custom(u8),
}

/// Memory allocation
#[derive(Debug, Clone)]
pub struct MemoryBlock {
    /// Allocation ID
    pub id: u32,
    /// Size in bytes
    pub size: usize,
    /// Pointer to data
    pub data: Vec<u8>,
    /// Whether block is free
    pub free: bool,
    /// Region type
    pub region: MemoryRegion,
}

/// Memory statistics
#[derive(Debug, Clone, Default)]
pub struct MemoryStats {
    /// Total allocated bytes
    pub total_allocated: usize,
    /// Currently used bytes
    pub used: usize,
    /// Number of allocations
    pub allocation_count: usize,
    /// Number of frees
    pub free_count: usize,
    /// Peak memory usage
    pub peak_usage: usize,
    /// Number of allocation failures
    pub alloc_failures: usize,
}

/// TVM Memory Manager
pub struct MemoryManager {
    /// Linear memory (wasm-compatible)
    linear_memory: Vec<u8>,
    /// Memory limit
    limit: usize,
    /// Stack base address
    stack_base: usize,
    /// Stack pointer
    stack_pointer: usize,
    /// Allocated blocks (for tracking)
    blocks: HashMap<u32, MemoryBlock>,
    /// Next block ID
    next_block_id: u32,
    /// Heap allocation pointer
    heap_ptr: usize,
    /// Memory statistics
    stats: MemoryStats,
}

impl MemoryManager {
    /// Create new memory manager
    pub fn new(limit: usize) -> Self {
        let heap_size = limit.saturating_sub(DEFAULT_STACK_SIZE);
        let stack_base = limit;

        Self {
            linear_memory: vec![0u8; limit],
            limit,
            stack_base,
            stack_pointer: limit,
            blocks: HashMap::new(),
            next_block_id: 1,
            heap_ptr: 0,
            stats: MemoryStats::default(),
        }
    }

    /// Get current memory state
    pub fn new_default() -> Self {
        Self::new(DEFAULT_MEMORY_LIMIT)
    }

    /// Read bytes from memory
    pub fn read(&self, addr: usize, len: usize) -> Option<&[u8]> {
        if addr + len > self.limit {
            return None;
        }
        Some(&self.linear_memory[addr..addr + len])
    }

    /// Write bytes to memory
    pub fn write(&mut self, addr: usize, data: &[u8]) -> bool {
        if addr + data.len() > self.limit {
            return false;
        }
        self.linear_memory[addr..addr + data.len()].copy_from_slice(data);
        true
    }

    /// Read a value from memory (generic)
    pub fn read_value<T: Copy>(&self, addr: usize) -> Option<T> {
        let size = std::mem::size_of::<T>();
        self.read(addr, size).map(|slice| {
            let mut value: T = unsafe { std::mem::zeroed() };
            unsafe {
                std::ptr::copy_nonoverlapping(
                    slice.as_ptr(),
                    &mut value as *mut T as *mut u8,
                    size,
                );
            }
            value
        })
    }

    /// Write a value to memory (generic)
    pub fn write_value<T: Copy>(&mut self, addr: usize, value: &T) -> bool {
        let size = std::mem::size_of::<T>();
        let slice = unsafe { std::slice::from_raw_parts(value as *const T as *const u8, size) };
        self.write(addr, slice)
    }

    /// Allocate memory on heap
    pub fn alloc(&mut self, size: usize) -> Option<u32> {
        if size == 0 {
            return Some(0);
        }

        let actual_size = (size + 3) & !3u32 as usize; // Align to 4 bytes

        if self.heap_ptr + actual_size > self.stack_base {
            self.stats.alloc_failures += 1;
            log::warn!("Memory allocation failed: heap exhausted");
            return None;
        }

        let addr = self.heap_ptr as u32;
        let block = MemoryBlock {
            id: self.next_block_id,
            size,
            data: vec![0u8; size],
            free: false,
            region: MemoryRegion::Heap,
        };

        self.blocks.insert(self.next_block_id, block);
        self.next_block_id += 1;
        self.heap_ptr += actual_size;

        self.stats.total_allocated += size;
        self.stats.used += size;
        self.stats.allocation_count += 1;

        if self.stats.used > self.stats.peak_usage {
            self.stats.peak_usage = self.stats.used;
        }

        log::debug!("Allocated {} bytes at 0x{:08x}", size, addr);
        Some(addr)
    }

    /// Free allocated memory
    pub fn free(&mut self, addr: u32) -> bool {
        if let Some(block) = self.blocks.get_mut(&addr) {
            if block.free {
                return false;
            }

            block.free = true;
            self.stats.used = self.stats.used.saturating_sub(block.size);
            self.stats.free_count += 1;

            log::debug!("Freed block at 0x{:08x}", addr);
            return true;
        }
        false
    }

    /// Get memory statistics
    pub fn stats(&self) -> &MemoryStats {
        &self.stats
    }

    /// Get stack pointer
    pub fn stack_pointer(&self) -> usize {
        self.stack_pointer
    }

    /// Set stack pointer
    pub fn set_stack_pointer(&mut self, ptr: usize) {
        if ptr >= self.heap_ptr && ptr <= self.stack_base {
            self.stack_pointer = ptr;
        }
    }

    /// Push value onto stack
    pub fn stack_push<T: Copy>(&mut self, value: &T) -> bool {
        let size = std::mem::size_of::<T>();
        if self.stack_pointer < size || self.stack_pointer - size < self.heap_ptr {
            return false;
        }

        self.stack_pointer -= size;
        self.write_value(self.stack_pointer, value)
    }

    /// Pop value from stack
    pub fn stack_pop<T: Copy>(&mut self) -> Option<T> {
        let size = std::mem::size_of::<T>();
        if self.stack_pointer + size > self.stack_base {
            return None;
        }

        let value = self.read_value::<T>(self.stack_pointer);
        self.stack_pointer += size;
        value
    }

    /// Check if address is in bounds
    pub fn is_valid_address(&self, addr: usize, size: usize) -> bool {
        addr < self.limit && addr + size <= self.limit
    }

    /// Get total memory limit
    pub fn limit(&self) -> usize {
        self.limit
    }

    /// Reset memory (for new execution)
    pub fn reset(&mut self) {
        self.linear_memory.fill(0);
        self.heap_ptr = 0;
        self.stack_pointer = self.stack_base;
        self.blocks.clear();
        self.stats = MemoryStats::default();
    }

    /// Copy memory region
    pub fn copy(&mut self, dest: usize, src: usize, len: usize) -> bool {
        if !self.is_valid_address(dest, len) || !self.is_valid_address(src, len) {
            return false;
        }

        let data = self.linear_memory[src..src + len].to_vec();
        self.linear_memory[dest..dest + len].copy_from_slice(&data);
        true
    }

    /// Fill memory region
    pub fn fill(&mut self, addr: usize, len: usize, value: u8) -> bool {
        if !self.is_valid_address(addr, len) {
            return false;
        }

        self.linear_memory[addr..addr + len].fill(value);
        true
    }

    /// Compare memory regions
    pub fn compare(&self, addr1: usize, addr2: usize, len: usize) -> Option<std::cmp::Ordering> {
        let slice1 = self.read(addr1, len)?;
        let slice2 = self.read(addr2, len)?;
        Some(slice1.cmp(slice2))
    }
}

/// TVM Register file
#[derive(Debug, Clone, Default)]
pub struct RegisterFile {
    /// General purpose registers (R0-R7)
    pub regs: [u32; 8],
    /// Stack pointer
    pub sp: u32,
    /// Base pointer
    pub bp: u32,
    /// Program counter
    pub pc: u32,
    /// Flags register
    pub flags: u32,
    /// Reserved for system
    pub sys: u32,
}

impl RegisterFile {
    /// Create new register file
    pub fn new() -> Self {
        Self::default()
    }

    /// Get register value
    pub fn get(&self, idx: usize) -> u32 {
        if idx < 8 {
            self.regs[idx]
        } else {
            0
        }
    }

    /// Set register value
    pub fn set(&mut self, idx: usize, value: u32) {
        if idx < 8 {
            self.regs[idx] = value;
        }
    }

    /// Set zero flag based on value
    pub fn update_zf(&mut self, value: u32) {
        if value == 0 {
            self.flags |= 0x01; // ZF set
        } else {
            self.flags &= !0x01; // ZF clear
        }
    }

    /// Set sign flag based on value
    pub fn update_sf(&mut self, value: u32) {
        if (value as i32) < 0 {
            self.flags |= 0x02; // SF set
        } else {
            self.flags &= !0x02; // SF clear
        }
    }

    /// Set carry flag
    pub fn update_cf(&mut self, carry: bool) {
        if carry {
            self.flags |= 0x04;
        } else {
            self.flags &= !0x04;
        }
    }

    /// Set overflow flag
    pub fn update_of(&mut self, overflow: bool) {
        if overflow {
            self.flags |= 0x08;
        } else {
            self.flags &= !0x08;
        }
    }

    /// Check zero flag
    pub fn zf(&self) -> bool {
        self.flags & 0x01 != 0
    }

    /// Check sign flag
    pub fn sf(&self) -> bool {
        self.flags & 0x02 != 0
    }

    /// Check carry flag
    pub fn cf(&self) -> bool {
        self.flags & 0x04 != 0
    }

    /// Check overflow flag
    pub fn of(&self) -> bool {
        self.flags & 0x08 != 0
    }

    /// Reset registers
    pub fn reset(&mut self) {
        self.regs = [0; 8];
        self.sp = 0;
        self.bp = 0;
        self.pc = 0;
        self.flags = 0;
        self.sys = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_alloc() {
        let mut mem = MemoryManager::new_default();
        let addr = mem.alloc(1024).unwrap();
        assert!(addr > 0);
    }

    #[test]
    fn test_memory_read_write() {
        let mut mem = MemoryManager::new_default();
        mem.write(100, &[1, 2, 3, 4]).unwrap();
        let read = mem.read(100, 4).unwrap();
        assert_eq!(read, &[1, 2, 3, 4]);
    }

    #[test]
    fn test_stack() {
        let mut mem = MemoryManager::new_default();
        mem.stack_push(&42u32).unwrap();
        let val: u32 = mem.stack_pop().unwrap();
        assert_eq!(val, 42);
    }
}
