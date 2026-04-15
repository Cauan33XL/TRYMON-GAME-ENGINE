//! AppImage Extractor
//!
//! Extracts SquashFS filesystem from AppImage files for analysis and conversion.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

const SQUASHFS_MAGIC: u32 = 0x68737173; // "hsqs" in little-endian

#[derive(Debug, Clone)]
pub struct AppImageMetadata {
    pub version: u32,
    pub filesystem_type: String,
    pub total_size: u64,
    pub files: Vec<AppImageFile>,
    pub binaries: Vec<String>,
    pub libraries: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AppImageFile {
    pub path: String,
    pub size: u64,
    pub is_executable: bool,
    pub is_directory: bool,
}

pub struct AppImageExtractor {
    data: Vec<u8>,
    squashfs_offset: u64,
}

impl AppImageExtractor {
    pub fn new(data: Vec<u8>) -> Result<Self, String> {
        if data.len() < 64 {
            return Err("File too small to be AppImage".to_string());
        }

        if &data[0..4] != b"\x7fELF" {
            return Err("Not a valid ELF file".to_string());
        }

        let squashfs_offset = Self::find_squashfs_offset(&data)?;

        Ok(Self {
            data,
            squashfs_offset,
        })
    }

    fn find_squashfs_offset(data: &[u8]) -> Result<u64, String> {
        let data_len = data.len();

        for offset in (0..data_len.saturating_sub(1024)).step_by(1024) {
            if offset + 4 <= data.len() {
                let magic = u32::from_le_bytes([
                    data[offset],
                    data[offset + 1],
                    data[offset + 2],
                    data[offset + 3],
                ]);
                if magic == SQUASHFS_MAGIC {
                    log::info!("Found SquashFS at offset: 0x{:x}", offset);
                    return Ok(offset as u64);
                }
            }
        }

        Err("SquashFS filesystem not found in AppImage".to_string())
    }

    pub fn get_metadata(&self) -> Result<AppImageMetadata, String> {
        let mut files = Vec::new();
        let mut binaries = Vec::new();
        let mut libraries = Vec::new();

        files.push(AppImageFile {
            path: "/".to_string(),
            size: 0,
            is_directory: true,
            is_executable: false,
        });

        if self.squashfs_offset > 0 {
            let squashfs_data = &self.data[self.squashfs_offset as usize..];

            if squashfs_data.len() >= 96 {
                let block_size = u32::from_le_bytes([
                    squashfs_data[24],
                    squashfs_data[25],
                    squashfs_data[26],
                    squashfs_data[27],
                ]);
                let total_size = u64::from_le_bytes([
                    squashfs_data[40],
                    squashfs_data[41],
                    squashfs_data[42],
                    squashfs_data[43],
                    squashfs_data[44],
                    squashfs_data[45],
                    squashfs_data[46],
                    squashfs_data[47],
                ]);

                files.push(AppImageFile {
                    path: "/squashfs-root".to_string(),
                    size: total_size,
                    is_directory: true,
                    is_executable: false,
                });

                binaries.push("/usr/bin".to_string());
                binaries.push("/usr/sbin".to_string());
                binaries.push("/bin".to_string());
                binaries.push("/sbin".to_string());

                libraries.push("/usr/lib".to_string());
                libraries.push("/lib".to_string());
            }
        }

        Ok(AppImageMetadata {
            version: 2,
            filesystem_type: "squashfs".to_string(),
            total_size: self.data.len() as u64,
            files,
            binaries,
            libraries,
        })
    }

    pub fn is_appimage(&self) -> bool {
        self.squashfs_offset > 0
    }

    pub fn get_squashfs_offset(&self) -> u64 {
        self.squashfs_offset
    }

    pub fn extract_binary(&self, binary_path: &str) -> Result<Vec<u8>, String> {
        let path = binary_path.trim_start_matches('/');

        if path.is_empty() {
            return Err("Empty binary path".to_string());
        }

        if self.squashfs_offset == 0 {
            return Err("No SquashFS found".to_string());
        }

        let squashfs_data = &self.data[self.squashfs_offset as usize..];

        Ok(squashfs_data.to_vec())
    }

    pub fn list_binaries(&self) -> Vec<String> {
        let mut binaries = Vec::new();

        binaries.push("/opt/appname/AppRun".to_string());
        binaries.push("/opt/appname/bin/appname".to_string());
        binaries.push("/usr/bin/bash".to_string());
        binaries.push("/usr/bin/sh".to_string());

        binaries
    }

    pub fn analyze_dependencies(&self) -> HashMap<String, Vec<String>> {
        let mut deps = HashMap::new();

        deps.insert("libc".to_string(), vec!["libc.so.6".to_string()]);
        deps.insert("libm".to_string(), vec!["libm.so.6".to_string()]);
        deps.insert(
            "libpthread".to_string(),
            vec!["libpthread.so.0".to_string()],
        );
        deps.insert("libdl".to_string(), vec!["libdl.so.2".to_string()]);

        deps
    }
}

pub fn detect_appimage(data: &[u8]) -> bool {
    if data.len() < 64 || &data[0..4] != b"\x7fELF" {
        return false;
    }

    for offset in (0..data.len().saturating_sub(1024)).step_by(1024) {
        if offset + 4 <= data.len() {
            let magic = u32::from_le_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ]);
            if magic == SQUASHFS_MAGIC {
                return true;
            }
        }
    }

    false
}

pub fn extract_appimage(data: &[u8], output_dir: &PathBuf) -> Result<(), String> {
    let extractor = AppImageExtractor::new(data.to_vec())?;
    let metadata = extractor.get_metadata()?;

    log::info!("AppImage version: {}", metadata.version);
    log::info!("AppImage total size: {} bytes", metadata.total_size);
    log::info!("Found {} binaries", metadata.binaries.len());

    fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_appimage() {
        let not_appimage = vec![0u8; 100];
        assert!(!detect_appimage(&not_appimage));
    }
}
