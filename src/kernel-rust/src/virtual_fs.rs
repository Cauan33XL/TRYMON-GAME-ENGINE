//! Virtual File System Module
//! 
//! Provides a virtual filesystem for mounted binaries and extracted files.
//! This simulates a Linux filesystem hierarchy within WASM memory.

use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use uuid::Uuid;
use crate::error::{Result, KernelError};

/// File type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileType {
    /// Regular file
    File,
    /// Directory
    Directory,
    /// Symbolic link
    Symlink,
    /// Character device
    CharDevice,
    /// Block device
    BlockDevice,
}

/// Virtual file metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualFile {
    /// Unique identifier
    pub id: String,
    /// File name
    pub name: String,
    /// Full path
    pub path: String,
    /// File type
    pub file_type: FileType,
    /// File size in bytes
    pub size: usize,
    /// File content (for regular files)
    pub content: Option<Vec<u8>>,
    /// Parent directory path
    pub parent: Option<String>,
    /// Permissions (Unix-style: rwxrwxrwx)
    pub permissions: u16,
    /// Owner UID
    pub uid: u32,
    /// Owner GID
    pub gid: u32,
    /// Creation timestamp
    pub created_at: i64,
    /// Last modified timestamp
    pub modified_at: i64,
    /// Is executable
    pub executable: bool,
}

/// Mount point information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountPoint {
    /// Mount path
    pub path: String,
    /// Source (URL or blob reference)
    pub source: String,
    /// Filesystem type
    pub fs_type: String,
    /// Mount options
    pub options: Vec<String>,
    /// Is read-only
    pub read_only: bool,
}

/// Virtual FileSystem subsystem
pub struct VirtualFileSystem {
    /// File tree (path -> VirtualFile)
    files: HashMap<String, VirtualFile>,
    /// Mount points
    mounts: Vec<MountPoint>,
    /// Current working directory
    cwd: String,
    /// Whether VFS is initialized
    initialized: bool,
}

impl VirtualFileSystem {
    /// Create a new virtual filesystem
    pub fn new() -> Self {
        Self {
            files: HashMap::new(),
            mounts: Vec::new(),
            cwd: "/".to_string(),
            initialized: false,
        }
    }

    /// Initialize the VFS
    pub fn init(&mut self) -> Result<()> {
        log::info!("VirtualFileSystem initializing...");

        // Create base directory structure
        self.create_directory("/")?;
        self.create_directory("/bin")?;
        self.create_directory("/usr")?;
        self.create_directory("/usr/bin")?;
        self.create_directory("/usr/lib")?;
        self.create_directory("/etc")?;
        self.create_directory("/tmp")?;
        self.create_directory("/var")?;
        self.create_directory("/var/log")?;
        self.create_directory("/mnt")?;
        self.create_directory("/mnt/binary")?;
        self.create_directory("/home")?;
        self.create_directory("/proc")?;
        self.create_directory("/dev")?;
        self.create_directory("/sys")?;

        self.initialized = true;
        log::info!("VirtualFileSystem ready");
        Ok(())
    }

    /// Create a directory
    pub fn create_directory(&mut self, path: &str) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();

        let parent = if path == "/" {
            None
        } else {
            path_utils::parent(path).map(String::from)
        };

        let dir = VirtualFile {
            id,
            name: path_utils::filename(path).to_string(),
            path: path.to_string(),
            file_type: FileType::Directory,
            size: 0,
            content: None,
            parent,
            permissions: 0o755,
            uid: 0,
            gid: 0,
            created_at: now,
            modified_at: now,
            executable: true,
        };

        self.files.insert(path.to_string(), dir);
        Ok(())
    }

    /// Create a file with content
    pub fn create_file(&mut self, path: &str, content: Vec<u8>, executable: bool) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let size = content.len();

        let parent = path_utils::parent(path).map(String::from);

        let file = VirtualFile {
            id: id.clone(),
            name: path_utils::filename(path).to_string(),
            path: path.to_string(),
            file_type: FileType::File,
            size,
            content: Some(content),
            parent,
            permissions: if executable { 0o755 } else { 0o644 },
            uid: 0,
            gid: 0,
            created_at: now,
            modified_at: now,
            executable,
        };

        self.files.insert(path.to_string(), file);
        Ok(id)
    }

    /// Read a file's content
    pub fn read_file(&self, path: &str) -> Result<Vec<u8>> {
        let file = self.files.get(path)
            .ok_or_else(|| KernelError::FileSystemError(format!("File not found: {}", path)))?;

        if file.file_type != FileType::File {
            return Err(KernelError::FileSystemError("Not a file".into()));
        }

        file.content.clone()
            .ok_or_else(|| KernelError::FileSystemError("File has no content".into()))
    }

    /// Write to a file
    pub fn write_file(&mut self, path: &str, content: Vec<u8>) -> Result<()> {
        if let Some(file) = self.files.get_mut(path) {
            file.size = content.len();
            file.content = Some(content);
            file.modified_at = chrono::Utc::now().timestamp();
            Ok(())
        } else {
            // Create new file
            let _id = self.create_file(path, content, false)?;
            Ok(())
        }
    }

    /// List directory contents
    pub fn list_directory(&self, path: &str) -> Result<Vec<VirtualFile>> {
        let dir = self.files.get(path)
            .ok_or_else(|| KernelError::FileSystemError(format!("Directory not found: {}", path)))?;

        if dir.file_type != FileType::Directory {
            return Err(KernelError::FileSystemError("Not a directory".into()));
        }

        let children: Vec<VirtualFile> = self.files.values()
            .filter(|f| f.parent.as_deref() == Some(path))
            .cloned()
            .collect();

        Ok(children)
    }

    /// Mount a filesystem/image
    pub fn mount(&mut self, path: &str, source: &str, fs_type: &str) -> Result<()> {
        let mount = MountPoint {
            path: path.to_string(),
            source: source.to_string(),
            fs_type: fs_type.to_string(),
            options: Vec::new(),
            read_only: false,
        };

        self.mounts.push(mount);
        
        // Create mount point directory if it doesn't exist
        if !self.files.contains_key(path) {
            self.create_directory(path)?;
        }

        log::info!("Mounted {} at {} ({})", source, path, fs_type);
        Ok(())
    }

    /// Unmount a filesystem
    pub fn unmount(&mut self, path: &str) -> Result<()> {
        let pos = self.mounts.iter()
            .position(|m| m.path == path)
            .ok_or_else(|| KernelError::FileSystemError(format!("Not mounted: {}", path)))?;

        self.mounts.remove(pos);
        log::info!("Unmounted {}", path);
        Ok(())
    }

    /// Get mount points
    pub fn get_mounts(&self) -> &[MountPoint] {
        &self.mounts
    }

    /// Get file info
    pub fn get_file(&self, path: &str) -> Option<&VirtualFile> {
        self.files.get(path)
    }

    /// Get file info (mutable)
    pub fn get_file_mut(&mut self, path: &str) -> Option<&mut VirtualFile> {
        self.files.get_mut(path)
    }

    /// Delete a file or directory
    pub fn delete(&mut self, path: &str) -> Result<()> {
        if self.files.remove(path).is_some() {
            log::info!("Deleted {}", path);
            Ok(())
        } else {
            Err(KernelError::FileSystemError(format!("File not found: {}", path)))
        }
    }

    /// Change current working directory
    pub fn chdir(&mut self, path: &str) -> Result<()> {
        if self.files.contains_key(path) {
            self.cwd = path.to_string();
            Ok(())
        } else {
            Err(KernelError::FileSystemError(format!("Directory not found: {}", path)))
        }
    }

    /// Get current working directory
    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    /// Extract binary to filesystem
    pub fn extract_binary(&mut self, binary_path: &str, content: &[u8]) -> Result<String> {
        let full_path = if binary_path.starts_with('/') {
            binary_path.to_string()
        } else {
            format!("{}/{}", self.cwd, binary_path)
        };

        // Ensure parent directory exists
        if let Some(parent) = path_utils::parent(&full_path) {
            if !self.files.contains_key(parent) {
                self.create_directory(parent)?;
            }
        }

        self.create_file(&full_path, content.to_vec(), true)
    }

    /// Get filesystem statistics
    pub fn stats(&self) -> FileSystemStats {
        let total_files = self.files.values().filter(|f| f.file_type == FileType::File).count();
        let total_dirs = self.files.values().filter(|f| f.file_type == FileType::Directory).count();
        let total_size: usize = self.files.values()
            .filter_map(|f| if f.file_type == FileType::File { Some(f.size) } else { None })
            .sum();

        FileSystemStats {
            total_files,
            total_directories: total_dirs,
            total_size,
            mount_points: self.mounts.len(),
        }
    }

    /// Complete a partial path for tab-completion
    pub fn complete_path(&self, partial: &str) -> Option<String> {
        let (dir_path, file_prefix) = if partial.contains('/') {
            let last_slash = partial.rfind('/').unwrap();
            let d = if last_slash == 0 { "/" } else { &partial[..last_slash] };
            let f = &partial[last_slash + 1..];
            (d, f)
        } else {
            (self.cwd.as_str(), partial)
        };

        let files = self.list_directory(dir_path).ok()?;
        let matches: Vec<&VirtualFile> = files.iter()
            .filter(|f| f.name.starts_with(file_prefix))
            .collect();

        if matches.len() == 1 {
            let mut name = matches[0].name.clone();
            if matches[0].file_type == FileType::Directory {
                name.push('/');
            }
            Some(name[file_prefix.len()..].to_string())
        } else {
            None
        }
    }

    /// Delete a file or directory recursively
    pub fn delete_recursive(&mut self, path: &str) -> Result<()> {
        // First, collect all children paths
        let children: Vec<String> = self.files.keys()
            .filter(|p| p.starts_with(path) && *p != path)
            .cloned()
            .collect();
        
        // Delete all children
        for child in children {
            self.files.remove(&child);
        }
        
        // Delete the path itself
        self.delete(path)
    }

    /// Copy a file or directory
    pub fn copy(&mut self, src: &str, dst: &str, recursive: bool) -> Result<()> {
        let src_file = self.files.get(src)
            .ok_or_else(|| KernelError::FileSystemError(format!("Source not found: {}", src)))?
            .clone();

        match src_file.file_type {
            FileType::File => {
                let content = src_file.content.clone().unwrap_or_default();
                self.create_file(dst, content, src_file.executable)?;
            }
            FileType::Directory => {
                if !recursive {
                    return Err(KernelError::FileSystemError("Is a directory (use -r)".into()));
                }
                self.create_directory(dst)?;
                
                // Copy all children
                let children: Vec<VirtualFile> = self.files.values()
                    .filter(|f| f.parent.as_deref() == Some(src))
                    .cloned()
                    .collect();
                
                for child in children {
                    let child_name = child.name.clone();
                    let new_src = if src.ends_with('/') {
                        format!("{}{}", src, child_name)
                    } else {
                        format!("{}/{}", src, child_name)
                    };
                    let new_dst = if dst.ends_with('/') {
                        format!("{}{}", dst, child_name)
                    } else {
                        format!("{}/{}", dst, child_name)
                    };
                    self.copy(&new_src, &new_dst, recursive)?;
                }
            }
            _ => return Err(KernelError::FileSystemError("Unsupported file type".into())),
        }

        Ok(())
    }

    /// Rename/move a file or directory
    pub fn rename(&mut self, src: &str, dst: &str) -> Result<()> {
        let src_file = self.files.get(src)
            .ok_or_else(|| KernelError::FileSystemError(format!("Source not found: {}", src)))?
            .clone();

        // Update the source file's path
        if let Some(file) = self.files.get_mut(src) {
            file.path = dst.to_string();
            file.name = path_utils::filename(dst).to_string();
            file.parent = path_utils::parent(dst).map(String::from);
            file.modified_at = chrono::Utc::now().timestamp();
        }

        // Update all children paths
        let children: Vec<String> = self.files.keys()
            .filter(|p| p.starts_with(src) && *p != src)
            .cloned()
            .collect();

        for old_path in children {
            let new_path = old_path.replacen(src, dst, 1);
            if let Some(file) = self.files.get(&old_path) {
                let mut updated = file.clone();
                updated.path = new_path.clone();
                self.files.remove(&old_path);
                self.files.insert(new_path, updated);
            }
        }

        Ok(())
    }

    /// Change file permissions
    pub fn chmod(&mut self, path: &str, permissions: u32) -> Result<()> {
        let file = self.files.get_mut(path)
            .ok_or_else(|| KernelError::FileSystemError(format!("File not found: {}", path)))?;
        
        file.permissions = permissions as u16;
        file.executable = (permissions & 0o111) != 0; // Check if any execute bit is set
        file.modified_at = chrono::Utc::now().timestamp();
        Ok(())
    }

    /// Find files matching a pattern
    pub fn find_files(&self, path: &str, name_filter: Option<&str>) -> Result<Vec<String>> {
        let mut results = Vec::new();
        
        for (file_path, file) in &self.files {
            if !file_path.starts_with(path) {
                continue;
            }

            if let Some(pattern) = name_filter {
                // Simple glob matching
                if self.glob_match(&file.name, pattern) {
                    results.push(file_path.clone());
                }
            } else {
                results.push(file_path.clone());
            }
        }

        Ok(results)
    }

    /// Simple glob pattern matching
    fn glob_match(&self, text: &str, pattern: &str) -> bool {
        if pattern == "*" {
            return true;
        }
        
        // Convert glob pattern to regex-like matching
        let pattern_regex = pattern
            .replace(".", "\\.")
            .replace("*", ".*")
            .replace("?", ".");
        
        // Simple implementation - just check if pattern matches
        text == pattern || pattern == "*"
    }

    /// Create a symbolic link
    pub fn create_symlink(&mut self, link_path: &str, target: &str) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();

        let link_file = VirtualFile {
            id: id.clone(),
            name: path_utils::filename(link_path).to_string(),
            path: link_path.to_string(),
            file_type: FileType::Symlink,
            size: target.len(),
            content: Some(target.as_bytes().to_vec()),
            parent: path_utils::parent(link_path).map(String::from),
            permissions: 0o777,
            uid: 0,
            gid: 0,
            created_at: now,
            modified_at: now,
            executable: false,
        };

        self.files.insert(link_path.to_string(), link_file);
        Ok(id)
    }

    /// Create a hard link
    pub fn create_hard_link(&mut self, link_path: &str, target: &str) -> Result<String> {
        let target_file = self.files.get(target)
            .ok_or_else(|| KernelError::FileSystemError(format!("Target not found: {}", target)))?
            .clone();

        let mut link_file = target_file;
        link_file.path = link_path.to_string();
        link_file.name = path_utils::filename(link_path).to_string();
        link_file.parent = path_utils::parent(link_path).map(String::from);

        let id = link_file.id.clone();
        self.files.insert(link_path.to_string(), link_file);
        Ok(id)
    }

    /// Read a symbolic link
    pub fn read_symlink(&self, link_path: &str) -> Result<String> {
        let file = self.files.get(link_path)
            .ok_or_else(|| KernelError::FileSystemError(format!("File not found: {}", link_path)))?;

        if file.file_type != FileType::Symlink {
            return Err(KernelError::FileSystemError("Not a symbolic link".into()));
        }

        let target = String::from_utf8_lossy(
            file.content.as_ref().ok_or_else(|| KernelError::FileSystemError("Empty symlink".into()))?
        ).to_string();
        
        Ok(target)
    }

    /// Get file information
    pub fn get_file_info(&self, path: &str) -> Result<VirtualFile> {
        self.files.get(path)
            .cloned()
            .ok_or_else(|| KernelError::FileSystemError(format!("File not found: {}", path)))
    }

    /// Create an empty file (convenience method)
    pub fn create_empty_file(&mut self, path: &str) -> Result<String> {
        self.create_file(path, Vec::new(), false)
    }
}

/// Filesystem statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSystemStats {
    /// Total number of files
    pub total_files: usize,
    /// Total number of directories
    pub total_directories: usize,
    /// Total size of all files (bytes)
    pub total_size: usize,
    /// Number of mount points
    pub mount_points: usize,
}

/// Path utility functions
mod path_utils {
    /// Get the filename component of a path
    pub fn filename(path: &str) -> &str {
        if path == "/" {
            return "/";
        }
        path.rsplit('/').next().unwrap_or(path)
    }

    /// Get the parent directory path
    pub fn parent(path: &str) -> Option<&str> {
        if path == "/" {
            return None;
        }
        let last_slash = path.rfind('/')?;
        if last_slash == 0 {
            Some("/")
        } else {
            Some(&path[..last_slash])
        }
    }
}
