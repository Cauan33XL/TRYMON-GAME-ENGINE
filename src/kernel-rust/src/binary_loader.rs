//! Binary Loader Module
//! 
//! Handles parsing and loading of Linux binary formats:
//! - .AppImage (SquashFS embedded in ELF)
//! - .deb (Debian package - ar archive)
//! - .rpm (Red Hat Package Manager - cpio archive)

use std::collections::HashMap;
use uuid::Uuid;
use serde::{Serialize, Deserialize};
use crate::error::{Result, KernelError};

/// Supported binary formats
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryFormat {
    /// AppImage format
    AppImage,
    /// Debian package
    Deb,
    /// Red Hat package
    Rpm,
    /// Generic ELF executable
    Elf,
    /// Unknown format
    Unknown,
}

impl std::fmt::Display for BinaryFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AppImage => write!(f, "AppImage"),
            Self::Deb => write!(f, "deb"),
            Self::Rpm => write!(f, "rpm"),
            Self::Elf => write!(f, "ELF"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Information about a loaded binary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryInfo {
    /// Unique identifier
    pub id: String,
    /// Original filename
    pub name: String,
    /// Binary format
    pub format: BinaryFormat,
    /// File size in bytes
    pub size: usize,
    /// Executable entry point (if applicable)
    pub entry_point: Option<String>,
    /// Extracted files (for packages)
    pub extracted_files: Vec<String>,
    /// Load status
    pub status: BinaryStatus,
    /// Metadata from package
    pub metadata: Option<PackageMetadata>,
}

/// Binary loading status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BinaryStatus {
    /// Successfully loaded and ready
    Ready,
    /// Currently loading
    Loading,
    /// Error during load
    Error(String),
}

/// Package metadata (for .deb and .rpm)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageMetadata {
    /// Package name
    pub name: Option<String>,
    /// Package version
    pub version: Option<String>,
    /// Architecture
    pub architecture: Option<String>,
    /// Description
    pub description: Option<String>,
    /// Maintainer
    pub maintainer: Option<String>,
    /// Dependencies
    pub dependencies: Vec<String>,
}

/// Binary data stored in memory
pub struct BinaryData {
    /// Raw binary data
    pub data: Vec<u8>,
    /// Parsed information
    pub info: BinaryInfo,
    /// Extracted executable (if applicable)
    pub executable: Option<Vec<u8>>,
}

/// Binary Loader subsystem
pub struct BinaryLoader {
    /// Loaded binaries
    binaries: HashMap<String, BinaryData>,
    /// Whether the loader is initialized
    initialized: bool,
}

impl BinaryLoader {
    /// Create a new binary loader
    pub fn new() -> Self {
        Self {
            binaries: HashMap::new(),
            initialized: false,
        }
    }

    /// Initialize the loader
    pub fn init(&mut self) -> Result<()> {
        log::info!("BinaryLoader initializing");
        self.initialized = true;
        Ok(())
    }

    /// Load a binary file from raw data
    pub fn load_binary(&mut self, name: &str, data: &[u8]) -> Result<BinaryInfo> {
        if !self.initialized {
            return Err(KernelError::LoadError("Loader not initialized".into()));
        }

        log::info!("Loading binary: {} ({} bytes)", name, data.len());

        // Detect format
        let format = Self::detect_format(name, data)?;

        // Create binary info
        let id = Uuid::new_v4().to_string();
        let mut info = BinaryInfo {
            id: id.clone(),
            name: name.to_string(),
            format,
            size: data.len(),
            entry_point: None,
            extracted_files: Vec::new(),
            status: BinaryStatus::Loading,
            metadata: None,
        };

        // Parse based on format
        let (executable, metadata) = match format {
            BinaryFormat::AppImage => self.parse_appimage(data, &mut info)?,
            BinaryFormat::Deb => self.parse_deb(data, &mut info)?,
            BinaryFormat::Rpm => self.parse_rpm(data, &mut info)?,
            BinaryFormat::Elf => self.parse_elf(data, &mut info)?,
            BinaryFormat::Unknown => {
                return Err(KernelError::UnsupportedFormat(name.to_string()));
            }
        };

        info.metadata = metadata;
        info.status = BinaryStatus::Ready;

        // Store binary
        self.binaries.insert(id.clone(), BinaryData {
            data: data.to_vec(),
            info: info.clone(),
            executable,
        });

        log::info!("Binary loaded successfully: {} (id: {})", name, id);
        Ok(info)
    }

    /// Get loaded binary by ID
    pub fn get_binary(&self, id: &str) -> Option<&BinaryData> {
        self.binaries.get(id)
    }

    /// Get binary info by ID
    pub fn get_binary_info(&self, id: &str) -> Option<&BinaryInfo> {
        self.binaries.get(id).map(|b| &b.info)
    }

    /// List all loaded binaries
    pub fn loaded_binaries(&self) -> Vec<BinaryInfo> {
        self.binaries.values().map(|b| b.info.clone()).collect()
    }

    /// Remove a loaded binary
    pub fn remove_binary(&mut self, id: &str) -> Result<()> {
        if self.binaries.remove(id).is_some() {
            log::info!("Binary removed: {}", id);
            Ok(())
        } else {
            Err(KernelError::InvalidBinary(id.to_string()))
        }
    }

    // ============================================================
    // Format-specific parsers
    // ============================================================

    /// Parse AppImage format
    /// AppImage is an ELF executable with embedded SquashFS
    fn parse_appimage(&self, data: &[u8], info: &mut BinaryInfo) -> Result<(Option<Vec<u8>>, Option<PackageMetadata>)> {
        log::info!("Parsing AppImage: {}", info.name);

        // Verify ELF magic bytes
        if data.len() < 4 || &data[0..4] != b"\x7fELF" {
            return Err(KernelError::InvalidBinary("Not a valid ELF file".into()));
        }

        // Find SquashFS magic bytes (hsqs)
        let squashfs_offset = Self::find_magic(data, b"hsqs")
            .ok_or_else(|| KernelError::ParseError("SquashFS filesystem not found in AppImage".into()))?;

        log::info!("SquashFS found at offset: {}", squashfs_offset);

        // Extract ELF header as executable
        info.entry_point = Some("/AppRun".to_string());
        info.extracted_files.push("AppRun".to_string());
        info.extracted_files.push("squashfs-root/".to_string());

        Ok((Some(data.to_vec()), None))
    }

    /// Parse Debian .deb package
    /// .deb is an ar archive containing control.tar and data.tar
    fn parse_deb(&self, data: &[u8], info: &mut BinaryInfo) -> Result<(Option<Vec<u8>>, Option<PackageMetadata>)> {
        log::info!("Parsing DEB package: {}", info.name);

        // Verify ar magic bytes
        if data.len() < 8 || &data[0..8] != b"!<arch>\n" {
            return Err(KernelError::InvalidBinary("Not a valid ar archive".into()));
        }

        // Parse ar archive headers (simplified)
        // Real implementation would use the `ar` crate
        let mut files = Vec::new();
        let mut metadata = None;

        // Look for control.tar.gz or control.tar.xz
        if Self::find_magic(data, b"control.tar").is_some() {
            files.push("control.tar".to_string());
            // Parse control file for metadata
            metadata = Some(self.parse_deb_control(data)?);
        }

        // Look for data.tar.gz or data.tar.xz
        if Self::find_magic(data, b"data.tar").is_some() {
            files.push("data.tar".to_string());
        }

        info.extracted_files = files;

        Ok((None, metadata))
    }

    /// Parse control section from .deb package
    fn parse_deb_control(&self, _data: &[u8]) -> Result<PackageMetadata> {
        // Simplified - would parse actual control file
        Ok(PackageMetadata {
            name: None,
            version: None,
            architecture: None,
            description: None,
            maintainer: None,
            dependencies: Vec::new(),
        })
    }

    /// Parse RPM package
    /// RPM has a complex header + cpio archive structure
    fn parse_rpm(&self, data: &[u8], info: &mut BinaryInfo) -> Result<(Option<Vec<u8>>, Option<PackageMetadata>)> {
        log::info!("Parsing RPM package: {}", info.name);

        // Verify RPM magic bytes (edabeedb)
        if data.len() < 4 || &data[0..4] != &[0xed, 0xab, 0xee, 0xdb] {
            return Err(KernelError::InvalidBinary("Not a valid RPM package".into()));
        }

        // Parse RPM header (simplified)
        // Real implementation would use the `rpm-rs` crate
        let mut metadata = None;

        if data.len() > 100 {
            metadata = Some(PackageMetadata {
                name: Some(info.name.clone()),
                version: None,
                architecture: None,
                description: None,
                maintainer: None,
                dependencies: Vec::new(),
            });
        }

        info.extracted_files.push("payload.cpio".to_string());

        Ok((None, metadata))
    }

    /// Parse generic ELF executable
    fn parse_elf(&self, data: &[u8], info: &mut BinaryInfo) -> Result<(Option<Vec<u8>>, Option<PackageMetadata>)> {
        // Verify ELF magic bytes
        if data.len() < 4 || &data[0..4] != b"\x7fELF" {
            return Err(KernelError::InvalidBinary("Not a valid ELF file".into()));
        }

        info.entry_point = Some(format!("/usr/bin/{}", info.name));
        Ok((Some(data.to_vec()), None))
    }

    // ============================================================
    // Utility functions
    // ============================================================

    /// Detect binary format from filename and magic bytes
    fn detect_format(name: &str, data: &[u8]) -> Result<BinaryFormat> {
        // Check filename extension first
        if name.ends_with(".appimage") || name.ends_with(".AppImage") {
            return Ok(BinaryFormat::AppImage);
        }
        if name.ends_with(".deb") {
            return Ok(BinaryFormat::Deb);
        }
        if name.ends_with(".rpm") {
            return Ok(BinaryFormat::Rpm);
        }

        // Check magic bytes
        if data.len() >= 4 {
            if &data[0..4] == b"\x7fELF" {
                // Could be AppImage or plain ELF
                if Self::find_magic(data, b"hsqs").is_some() {
                    return Ok(BinaryFormat::AppImage);
                }
                return Ok(BinaryFormat::Elf);
            }
            if &data[0..8] == b"!<arch>\n" {
                return Ok(BinaryFormat::Deb);
            }
            if data.len() >= 4 && &data[0..4] == &[0xed, 0xab, 0xee, 0xdb] {
                return Ok(BinaryFormat::Rpm);
            }
        }

        Ok(BinaryFormat::Unknown)
    }

    /// Find magic bytes pattern in data
    fn find_magic(data: &[u8], magic: &[u8]) -> Option<usize> {
        if data.len() < magic.len() {
            return None;
        }

        data.windows(magic.len())
            .position(|window| window == magic)
    }
}
