//! Interactive Shell Module
//!
//! Provides a bash-like command line interface for the TRYMON kernel.
//! Supports built-in commands, environment variables, I/O redirection,
//! pipes, job control, aliases, and shell functions.

use crate::binary_loader::BinaryLoader;
use crate::error::{KernelError, Result};
use crate::process_manager::ProcessManager;
use crate::virtual_fs::VirtualFileSystem;
use std::collections::HashMap;

/// Maximum history size
const MAX_HISTORY: usize = 1000;
/// Maximum alias count
const MAX_ALIASES: usize = 50;

/// Shell state
pub struct Shell {
    /// Current prompt
    prompt: String,
    /// Current user
    user: String,
    /// Current hostname
    hostname: String,
    /// History of commands
    history: Vec<String>,
    /// Current position in history (for up/down navigation)
    history_position: usize,
    /// Environment variables
    env: HashMap<String, String>,
    /// Buffer for current line
    line_buffer: String,
    /// Cursor position in line_buffer (for left/right arrow keys)
    cursor_position: usize,
    /// Shell aliases (alias_name -> command)
    aliases: HashMap<String, String>,
    /// Whether we're in the middle of reading multi-line input
    in_continuation: bool,
    /// Continuation prompt (default: "> ")
    continuation_prompt: String,
    /// Buffer for multi-line input
    continuation_buffer: String,
    /// Last exit code
    last_exit_code: i32,
}

impl Shell {
    /// Create a new shell instance
    pub fn new() -> Self {
        let mut env = HashMap::new();
        env.insert(
            "PATH".to_string(),
            "/usr/local/bin:/usr/bin:/bin".to_string(),
        );
        env.insert("HOME".to_string(), "/root".to_string());
        env.insert("TERM".to_string(), "xterm-256color".to_string());
        env.insert("SHELL".to_string(), "/bin/bash".to_string());
        env.insert("USER".to_string(), "root".to_string());
        env.insert("LANG".to_string(), "C.UTF-8".to_string());
        env.insert("LOGNAME".to_string(), "root".to_string());
        env.insert("PWD".to_string(), "/".to_string());
        env.insert("SHLVL".to_string(), "1".to_string());

        Self {
            prompt: "root@trymon:/# ".to_string(),
            user: "root".to_string(),
            hostname: "trymon".to_string(),
            history: Vec::new(),
            history_position: 0,
            env,
            line_buffer: String::new(),
            cursor_position: 0,
            aliases: HashMap::new(),
            in_continuation: false,
            continuation_prompt: "> ".to_string(),
            continuation_buffer: String::new(),
            last_exit_code: 0,
        }
    }

    /// Update prompt based on current working directory
    pub fn update_prompt(&mut self, vfs: &VirtualFileSystem) {
        let cwd = vfs.cwd();
        let display_path = if cwd == "/root"
            || cwd == self.env.get("HOME").map(|s| s.as_str()).unwrap_or("/root")
        {
            "~".to_string()
        } else if let Some(home) = self.env.get("HOME") {
            if cwd.starts_with(home.as_str()) {
                format!("~{}", &cwd[home.len()..])
            } else {
                cwd.to_string()
            }
        } else {
            cwd.to_string()
        };

        self.prompt = format!("{}@{}:{}$ ", self.user, self.hostname, display_path);
        // Update PWD in environment
        self.env.insert("PWD".to_string(), cwd.to_string());
    }

    /// Get current prompt
    pub fn get_prompt(&self) -> &str {
        &self.prompt
    }

    /// Expand environment variables in a string ($VAR, ${VAR}, $HOME, etc.)
    fn expand_variables(&self, input: &str) -> String {
        let mut result = String::new();
        let mut chars = input.chars().peekable();

        while let Some(c) = chars.next() {
            if c == '$' {
                if let Some(&next) = chars.peek() {
                    if next == '{' {
                        // ${VAR} syntax
                        chars.next(); // consume '{'
                        let mut var_name = String::new();
                        loop {
                            match chars.next() {
                                Some('}') => break,
                                Some(c) => var_name.push(c),
                                None => break,
                            }
                        }
                        if let Some(value) = self.env.get(&var_name) {
                            result.push_str(value);
                        }
                    } else if next.is_alphabetic() || next == '_' {
                        // $VAR syntax
                        let mut var_name = String::new();
                        loop {
                            match chars.peek() {
                                Some(&c) if c.is_alphanumeric() || c == '_' => {
                                    var_name.push(chars.next().unwrap());
                                }
                                _ => break,
                            }
                        }
                        if let Some(value) = self.env.get(&var_name) {
                            result.push_str(value);
                        }
                    } else if next == '$' {
                        // $$ - PID (simplified)
                        chars.next();
                        result.push_str("1");
                    } else if next == '?' {
                        // $? - last exit code
                        chars.next();
                        result.push_str(&self.last_exit_code.to_string());
                    } else {
                        result.push('$');
                    }
                } else {
                    result.push('$');
                }
            } else if c == '\\' {
                // Escape sequence
                if let Some(&next) = chars.peek() {
                    chars.next();
                    match next {
                        'n' => result.push('\n'),
                        't' => result.push('\t'),
                        '\\' => result.push('\\'),
                        '"' => result.push('"'),
                        '$' => result.push('$'),
                        _ => {
                            result.push('\\');
                            result.push(next);
                        }
                    }
                } else {
                    result.push('\\');
                }
            } else {
                result.push(c);
            }
        }

        result
    }

    /// Handle keyboard input (keystroke)
    pub fn handle_input(
        &mut self,
        input: &str,
        vfs: &mut VirtualFileSystem,
        processes: &mut ProcessManager,
        loader: &BinaryLoader,
    ) -> String {
        let mut output = String::new();

        for c in input.chars() {
            match c {
                '\r' | '\n' => {
                    output.push('\n');

                    if self.in_continuation {
                        // Add to continuation buffer
                        self.continuation_buffer.push_str(&self.line_buffer);
                        self.continuation_buffer.push('\n');
                        self.line_buffer.clear();

                        // Execute the full multi-line command
                        let cmd_line = self.continuation_buffer.trim().to_string();
                        self.continuation_buffer.clear();
                        self.in_continuation = false;

                        if !cmd_line.is_empty() {
                            self.history.push(cmd_line.clone());
                            if self.history.len() > MAX_HISTORY {
                                self.history.remove(0);
                            }
                            let cmd_output =
                                self.execute_command(&cmd_line, vfs, processes, loader);
                            output.push_str(&cmd_output);
                            if !cmd_output.is_empty() && !cmd_output.ends_with('\n') {
                                output.push('\n');
                            }
                        }
                    } else {
                        let cmd_line = self.line_buffer.trim().to_string();
                        if !cmd_line.is_empty() {
                            self.history.push(cmd_line.clone());
                            if self.history.len() > MAX_HISTORY {
                                self.history.remove(0);
                            }
                            let cmd_output =
                                self.execute_command(&cmd_line, vfs, processes, loader);
                            output.push_str(&cmd_output);
                            if !cmd_output.is_empty() && !cmd_output.ends_with('\n') {
                                output.push('\n');
                            }
                        }
                        self.line_buffer.clear();
                    }

                    self.cursor_position = 0;
                    self.history_position = self.history.len();
                    self.update_prompt(vfs);
                    output.push_str(&self.prompt);
                }
                '\u{0008}' | '\u{007f}' => {
                    // Backspace
                    if self.cursor_position > 0 {
                        self.line_buffer.remove(self.cursor_position - 1);
                        self.cursor_position -= 1;
                        // Redraw line
                        output.push_str("\r\x1b[K"); // Clear line
                        output.push_str(&self.prompt);
                        output.push_str(&self.line_buffer);
                        // Move cursor back
                        if self.cursor_position < self.line_buffer.len() {
                            output.push_str(&format!(
                                "\x1b[{}D",
                                self.line_buffer.len() - self.cursor_position
                            ));
                        }
                    }
                }
                '\u{001B}' => {
                    // Escape sequence (arrow keys, etc.)
                    // Will be handled by caller reading more chars
                    output.push(c);
                }
                '\t' => {
                    // Tab completion
                    let completion = self.tab_complete(&self.line_buffer, vfs);
                    if !completion.is_empty() {
                        let current = &self.line_buffer[..self.cursor_position];
                        let last_space = current.rfind(' ').map(|i| i + 1).unwrap_or(0);
                        let partial = &current[last_space..];

                        // Remove partial and add completion
                        for _ in 0..partial.len() {
                            if self.cursor_position > 0 {
                                self.line_buffer.remove(self.cursor_position - 1);
                                self.cursor_position -= 1;
                            }
                        }

                        let insert_pos = self.cursor_position;
                        for c in completion.chars() {
                            self.line_buffer.insert(insert_pos, c);
                        }
                        self.cursor_position += completion.len();

                        // Redraw line
                        output.push_str("\r\x1b[K");
                        output.push_str(&self.prompt);
                        output.push_str(&self.line_buffer);
                        if self.cursor_position < self.line_buffer.len() {
                            output.push_str(&format!(
                                "\x1b[{}D",
                                self.line_buffer.len() - self.cursor_position
                            ));
                        }
                    }
                }
                '\u{0003}' => {
                    // Ctrl+C
                    output.push_str("^C\n");
                    self.line_buffer.clear();
                    self.cursor_position = 0;
                    self.continuation_buffer.clear();
                    self.in_continuation = false;
                    self.update_prompt(vfs);
                    output.push_str(&self.prompt);
                }
                '\u{0004}' => {
                    // Ctrl+D (exit)
                    if self.line_buffer.is_empty() {
                        output.push_str("exit\n");
                        return output;
                    }
                }
                '\u{000C}' => {
                    // Ctrl+L (clear)
                    output.push_str("\x1b[2J\x1b[H");
                    output.push_str(&self.prompt);
                    output.push_str(&self.line_buffer);
                }
                _ => {
                    if self.cursor_position == self.line_buffer.len() {
                        self.line_buffer.push(c);
                        self.cursor_position += 1;
                        output.push(c);
                    } else {
                        // Insert at cursor position
                        self.line_buffer.insert(self.cursor_position, c);
                        self.cursor_position += 1;
                        // Redraw from cursor
                        output.push_str(&self.line_buffer[self.cursor_position - 1..]);
                        output.push_str(&format!(
                            "\x1b[{}D",
                            self.line_buffer.len() - self.cursor_position
                        ));
                    }
                }
            }
        }

        output
    }

    /// Tab completion helper
    fn tab_complete(&self, input: &str, vfs: &VirtualFileSystem) -> String {
        let input_lower = input.to_lowercase();

        // Try commands first
        let commands = vec![
            "ls", "cd", "pwd", "cat", "echo", "mkdir", "touch", "rm", "cp", "mv", "chmod", "chown",
            "grep", "find", "head", "tail", "wc", "sort", "uniq", "ps", "kill", "whoami", "uname",
            "date", "env", "export", "unset", "alias", "history", "clear", "help", "which", "file",
            "stat",
        ];

        let mut matches: Vec<&str> = commands
            .iter()
            .filter(|&&cmd| cmd.starts_with(&input_lower))
            .copied()
            .collect();

        if matches.len() == 1 {
            return matches[0].to_string();
        }

        // Try file/directory completion
        if let Some(completed) = vfs.complete_path(input) {
            return completed;
        }

        String::new()
    }

    /// Execute a command line
    fn execute_command(
        &mut self,
        line: &str,
        vfs: &mut VirtualFileSystem,
        processes: &mut ProcessManager,
        loader: &BinaryLoader,
    ) -> String {
        // Skip empty lines and comments
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            self.last_exit_code = 0;
            return String::new();
        }

        // Check for aliases
        let first_word = line.split_whitespace().next().unwrap_or("");
        let expanded_line = if let Some(alias_cmd) = self.aliases.get(first_word) {
            alias_cmd.clone() + &line[first_word.len()..]
        } else {
            line.to_string()
        };

        // Expand environment variables
        let expanded_line = self.expand_variables(&expanded_line);

        // Handle pipes (|)
        if expanded_line.contains('|') && !expanded_line.contains('"') {
            return self.execute_pipeline(&expanded_line, vfs, processes, loader);
        }

        // Handle redirections (>, >>, 2>&1)
        let (cmd_line, redirect_file, append_mode) = self.parse_redirection(&expanded_line);

        // Parse command and arguments
        let parts: Vec<String> = self.parse_args(&cmd_line);
        if parts.is_empty() {
            self.last_exit_code = 0;
            return String::new();
        }

        let cmd = &parts[0];
        let args: Vec<&str> = parts[1..].iter().map(|s| s.as_str()).collect();

        // Execute the command
        let output = match cmd.as_str() {
            "help" => self.cmd_help(),
            "ls" => self.cmd_ls(&args, vfs),
            "cd" => self.cmd_cd(&args, vfs),
            "pwd" => self.cmd_pwd(vfs),
            "cat" => self.cmd_cat(&args, vfs),
            "echo" => self.cmd_echo(&args),
            "clear" => "\x1b[2J\x1b[H".to_string(),
            "status" => self.cmd_status(processes, vfs),
            "ps" => self.cmd_ps(processes),
            "whoami" => format!("{}\n", self.user),
            "uname" => self.cmd_uname(&args),
            "mkdir" => self.cmd_mkdir(&args, vfs),
            "touch" => self.cmd_touch(&args, vfs),
            "rm" => self.cmd_rm(&args, vfs),
            "cp" => self.cmd_cp(&args, vfs),
            "mv" => self.cmd_mv(&args, vfs),
            "chmod" => self.cmd_chmod(&args, vfs),
            "grep" => self.cmd_grep(&args, vfs),
            "find" => self.cmd_find(&args, vfs),
            "head" => self.cmd_head(&args, vfs),
            "tail" => self.cmd_tail(&args, vfs),
            "wc" => self.cmd_wc(&args, vfs),
            "sort" => self.cmd_sort(&args, vfs),
            "uniq" => self.cmd_uniq(&args, vfs),
            "date" => self.cmd_date(),
            "env" => self.cmd_env(&args),
            "export" => self.cmd_export(&args),
            "unset" => self.cmd_unset(&args),
            "alias" => self.cmd_alias(&args),
            "unalias" => self.cmd_unalias(&args),
            "history" => self.cmd_history(),
            "which" => self.cmd_which(&args),
            "file" => self.cmd_file(&args, vfs),
            "stat" => self.cmd_stat(&args, vfs),
            "kill" => self.cmd_kill(&args, processes),
            "true" => {
                self.last_exit_code = 0;
                String::new()
            }
            "false" => {
                self.last_exit_code = 1;
                String::new()
            }
            "exit" => "exit\n".to_string(),
            "source" | "." => self.cmd_source(&args, vfs, processes, loader),
            "seq" => self.cmd_seq(&args),
            "tee" => self.cmd_tee(&args, vfs),
            "xargs" => self.cmd_xargs(&args, vfs, processes, loader),
            "basename" => self.cmd_basename(&args),
            "dirname" => self.cmd_dirname(&args),
            "realpath" => self.cmd_realpath(&args, vfs),
            "ln" => self.cmd_ln(&args, vfs),
            "readlink" => self.cmd_readlink(&args, vfs),
            "tree" => self.cmd_tree(&args, vfs),
            "du" => self.cmd_du(&args, vfs),
            "df" => self.cmd_df(vfs),
            "free" => self.cmd_free(processes),
            "uptime" => self.cmd_uptime(processes),
            "id" => self.cmd_id(),
            "hostname" => format!("{}\n", self.hostname),
            "yes" => self.cmd_yes(&args),
            "seq" => self.cmd_seq(&args),
            _ => {
                // Try executing as a binary
                match processes.execute_binary(loader, vfs, cmd) {
                    Ok(proc) => {
                        self.last_exit_code = 0;
                        format!("Started process {} (PID: {})\n", proc.name, proc.pid)
                    }
                    Err(_) => {
                        self.last_exit_code = 127;
                        format!("bash: {}: command not found\n", cmd)
                    }
                }
            }
        };

        // Handle redirection if specified
        if let Some(ref file_path) = redirect_file {
            let expanded_path = self.expand_variables(file_path);
            if append_mode {
                // Read existing content and append
                let existing = vfs.read_file(&expanded_path).unwrap_or_default();
                let mut content = String::from_utf8_lossy(&existing).to_string();
                content.push_str(&output);
                match vfs.write_file(&expanded_path, content.into_bytes()) {
                    Ok(_) => String::new(),
                    Err(e) => format!("{}: {}\n", file_path, e),
                }
            } else {
                match vfs.write_file(&expanded_path, output.clone().into_bytes()) {
                    Ok(_) => String::new(),
                    Err(e) => format!("{}: {}\n", file_path, e),
                }
            }
        } else {
            output
        }
    }

    /// Parse command-line arguments (handles quotes)
    fn parse_args(&self, line: &str) -> Vec<String> {
        let mut args = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        let mut in_single_quotes = false;
        let mut chars = line.chars().peekable();

        while let Some(c) = chars.next() {
            if in_single_quotes {
                if c == '\'' {
                    in_single_quotes = false;
                } else {
                    current.push(c);
                }
            } else if in_quotes {
                if c == '"' {
                    in_quotes = false;
                } else {
                    current.push(c);
                }
            } else {
                match c {
                    '"' => {
                        in_quotes = true;
                    }
                    '\'' => {
                        in_single_quotes = true;
                    }
                    ' ' => {
                        if !current.is_empty() {
                            args.push(current.clone());
                            current.clear();
                        }
                    }
                    _ => {
                        current.push(c);
                    }
                }
            }
        }

        if !current.is_empty() {
            args.push(current);
        }

        args
    }

    /// Parse redirection operators
    fn parse_redirection(&self, line: &str) -> (String, Option<String>, bool) {
        let mut append_mode = false;
        let mut redirect_file = None;
        let mut cmd_line = line.to_string();

        // Check for >> (append)
        if let Some(pos) = line.find(">>") {
            append_mode = true;
            let file_part = line[pos + 2..].trim();
            redirect_file = Some(
                file_part
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_string(),
            );
            cmd_line = line[..pos].trim().to_string();
        }
        // Check for > (overwrite)
        else if let Some(pos) = line.find('>') {
            let file_part = line[pos + 1..].trim();
            redirect_file = Some(
                file_part
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_string(),
            );
            cmd_line = line[..pos].trim().to_string();
        }

        (cmd_line, redirect_file, append_mode)
    }

    /// Execute a pipeline of commands (cmd1 | cmd2 | cmd3)
    fn execute_pipeline(
        &mut self,
        line: &str,
        vfs: &mut VirtualFileSystem,
        processes: &mut ProcessManager,
        loader: &BinaryLoader,
    ) -> String {
        let parts: Vec<&str> = line.split('|').map(|s| s.trim()).collect();
        let mut output = String::new();

        for cmd in parts {
            // For now, just execute the last command in the pipeline
            // TODO: Implement proper pipe handling with intermediate buffers
            output = self.execute_command(cmd, vfs, processes, loader);
        }

        output
    }

    // ============================================================
    // Built-in Commands
    // ============================================================

    fn cmd_help(&self) -> String {
        let mut help = String::from("\x1b[1;33mTRYMON Shell - Available commands:\x1b[0m\n\n");
        help.push_str("\x1b[1;36mFile Operations:\x1b[0m\n");
        help.push_str("  ls [path]           List directory contents\n");
        help.push_str("  cd <path>           Change working directory\n");
        help.push_str("  pwd                 Print working directory\n");
        help.push_str("  cat <file>          Display file contents\n");
        help.push_str("  mkdir <path>        Create directory\n");
        help.push_str("  touch <file>        Create empty file or update timestamp\n");
        help.push_str("  rm <path>           Remove file or directory\n");
        help.push_str("  cp <src> <dst>      Copy file or directory\n");
        help.push_str("  mv <src> <dst>      Move/rename file or directory\n");
        help.push_str("  chmod <mode> <file> Change file permissions\n");
        help.push_str("  find [path] [expr]  Search for files\n");
        help.push_str("  tree [path]         Display directory tree\n");
        help.push_str("\n");
        help.push_str("\x1b[1;36mText Processing:\x1b[0m\n");
        help.push_str("  grep [opts] <pat>   Search for patterns\n");
        help.push_str("  head [file]         Show first lines\n");
        help.push_str("  tail [file]         Show last lines\n");
        help.push_str("  wc [file]           Count lines, words, chars\n");
        help.push_str("  sort [file]         Sort lines\n");
        help.push_str("  uniq [file]         Remove duplicate lines\n");
        help.push_str("\n");
        help.push_str("\x1b[1;36mShell Features:\x1b[0m\n");
        help.push_str("  echo [text]         Display text\n");
        help.push_str("  env                 Show environment variables\n");
        help.push_str("  export VAR=val      Set environment variable\n");
        help.push_str("  unset VAR           Remove environment variable\n");
        help.push_str("  alias [name=cmd]    Show/set aliases\n");
        help.push_str("  history             Show command history\n");
        help.push_str("  which <cmd>         Locate command\n");
        help.push_str("\n");
        help.push_str("\x1b[1;36mSystem Info:\x1b[0m\n");
        help.push_str("  ps                  List processes\n");
        help.push_str("  kill <pid>          Terminate process\n");
        help.push_str("  whoami              Show current user\n");
        help.push_str("  uname [-a]          System information\n");
        help.push_str("  date                Show date and time\n");
        help.push_str("  hostname            Show hostname\n");
        help.push_str("  id                  Show user identity\n");
        help.push_str("  uptime              System uptime\n");
        help.push_str("  df                  Disk space usage\n");
        help.push_str("  free                Memory usage\n");
        help.push_str("  stat <file>         File status\n");
        help.push_str("\n");
        help.push_str("\x1b[1;36mOther:\x1b[0m\n");
        help.push_str("  clear               Clear terminal\n");
        help.push_str("  help                Show this help\n");
        help.push_str("  exit                Exit shell\n");
        help
    }

    fn cmd_ls(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut show_all = false;
        let mut long_format = false;
        let mut path = vfs.cwd();

        // Parse flags
        for arg in args {
            match *arg {
                "-a" | "--all" => show_all = true,
                "-l" => long_format = true,
                "-la" | "-al" => {
                    show_all = true;
                    long_format = true;
                }
                _ if !arg.starts_with('-') => path = *arg,
                _ => {}
            }
        }

        match vfs.list_directory(path) {
            Ok(files) => {
                let mut output = String::new();
                let filtered: Vec<_> = files
                    .iter()
                    .filter(|f| show_all || !f.name.starts_with('.'))
                    .collect();

                if long_format {
                    output.push_str(&format!("total {}\n", filtered.len()));
                    for file in filtered {
                        let perms = format!("{}", file.permissions);
                        let size = file.size;
                        let name = &file.name;
                        let color = if file.file_type == crate::virtual_fs::FileType::Directory {
                            "\x1b[1;34m"
                        } else if file.executable {
                            "\x1b[1;32m"
                        } else {
                            "\x1b[0m"
                        };
                        output
                            .push_str(&format!("{} {:>8} {}{}\x1b[0m\n", perms, size, color, name));
                    }
                } else {
                    for file in filtered {
                        let color = if file.file_type == crate::virtual_fs::FileType::Directory {
                            "\x1b[1;34m"
                        } else if file.executable {
                            "\x1b[1;32m"
                        } else {
                            "\x1b[0m"
                        };
                        output.push_str(&format!("{}{} \x1b[0m", color, file.name));
                    }
                    output.push('\n');
                }
                output
            }
            Err(e) => {
                self.last_exit_code = 1;
                format!("ls: {}: {}\n", path, e)
            }
        }
    }

    fn cmd_cd(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        let path = args
            .get(0)
            .copied()
            .unwrap_or(self.env.get("HOME").map(|s| s.as_str()).unwrap_or("/"));
        match vfs.chdir(path) {
            Ok(_) => {
                self.last_exit_code = 0;
                String::new()
            }
            Err(e) => {
                self.last_exit_code = 1;
                format!("cd: {}: {}\n", path, e)
            }
        }
    }

    fn cmd_pwd(&mut self, vfs: &VirtualFileSystem) -> String {
        format!("{}\n", vfs.cwd())
    }

    fn cmd_cat(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        if args.is_empty() {
            return "cat: missing operand\nTry 'cat --help' for more information.\n".to_string();
        }

        let mut output = String::new();
        let mut show_numbers = false;
        let files: Vec<&str> = args
            .iter()
            .filter(|&&arg| {
                if arg == "-n" {
                    show_numbers = true;
                    false
                } else {
                    !arg.starts_with('-')
                }
            })
            .copied()
            .collect();

        for path in files {
            match vfs.read_file(path) {
                Ok(content) => {
                    let text = String::from_utf8_lossy(&content);
                    if show_numbers {
                        for (i, line) in text.lines().enumerate() {
                            output.push_str(&format!("{:>6}\t{}\n", i + 1, line));
                        }
                    } else {
                        output.push_str(&text);
                        if !output.ends_with('\n') {
                            output.push('\n');
                        }
                    }
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("cat: {}: {}\n", path, e));
                }
            }
        }
        output
    }

    fn cmd_echo(&mut self, args: &[&str]) -> String {
        let mut suppress_newline = false;
        let mut texts = Vec::new();

        for arg in args {
            if *arg == "-n" {
                suppress_newline = true;
            } else if arg.starts_with('-') {
                // Skip other flags
            } else {
                texts.push(*arg);
            }
        }

        let output = texts.join(" ");
        if suppress_newline {
            output
        } else {
            format!("{}\n", output)
        }
    }

    fn cmd_mkdir(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        let mut parents = false;
        let paths: Vec<&str> = args
            .iter()
            .filter(|&&arg| {
                if arg == "-p" {
                    parents = true;
                    false
                } else {
                    !arg.starts_with('-')
                }
            })
            .copied()
            .collect();

        if paths.is_empty() {
            return "mkdir: missing operand\n".to_string();
        }

        let mut output = String::new();
        for path in paths {
            if parents {
                // Create parent directories as needed
                let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
                let mut current = String::new();
                for part in parts {
                    current.push('/');
                    current.push_str(part);
                    if let Err(e) = vfs.create_directory(&current) {
                        if current != "/" {
                            self.last_exit_code = 1;
                            output.push_str(&format!(
                                "mkdir: cannot create directory '{}': {}\n",
                                path, e
                            ));
                            break;
                        }
                    }
                }
            } else {
                match vfs.create_directory(path) {
                    Ok(_) => {
                        self.last_exit_code = 0;
                    }
                    Err(e) => {
                        self.last_exit_code = 1;
                        output.push_str(&format!(
                            "mkdir: cannot create directory '{}': {}\n",
                            path, e
                        ));
                    }
                }
            }
        }
        output
    }

    fn cmd_touch(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        if args.is_empty() {
            return "touch: missing file operand\n".to_string();
        }

        let mut output = String::new();
        for path in args.iter().filter(|&&arg| !arg.starts_with('-')) {
            match vfs.read_file(path) {
                Ok(_) => {
                    // File exists, update timestamp (simplified: do nothing)
                    self.last_exit_code = 0;
                }
                Err(_) => {
                    // Create new file
                    match vfs.create_empty_file(path) {
                        Ok(_) => self.last_exit_code = 0,
                        Err(e) => {
                            self.last_exit_code = 1;
                            output.push_str(&format!("touch: cannot touch '{}': {}\n", path, e));
                        }
                    }
                }
            }
        }
        output
    }

    fn cmd_rm(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        let mut recursive = false;
        let mut force = false;
        let paths: Vec<&str> = args
            .iter()
            .filter(|&&arg| match arg {
                "-r" | "-R" => {
                    recursive = true;
                    false
                }
                "-f" => {
                    force = true;
                    false
                }
                _ if arg.starts_with('-') => false,
                _ => true,
            })
            .copied()
            .collect();

        if paths.is_empty() && !force {
            return "rm: missing operand\nTry 'rm --help' for more information.\n".to_string();
        }

        let mut output = String::new();
        for path in paths {
            match vfs.delete(path) {
                Ok(_) => {
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    if recursive {
                        // Try recursive delete
                        match vfs.delete_recursive(path) {
                            Ok(_) => {
                                self.last_exit_code = 0;
                            }
                            Err(e2) => {
                                self.last_exit_code = 1;
                                output.push_str(&format!("rm: cannot remove '{}': {}\n", path, e2));
                            }
                        }
                    } else {
                        self.last_exit_code = 1;
                        if !force {
                            output.push_str(&format!("rm: cannot remove '{}': {}\n", path, e));
                        }
                    }
                }
            }
        }
        output
    }

    fn cmd_cp(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        let mut recursive = false;
        let mut files = Vec::new();

        for arg in args {
            match *arg {
                "-r" | "-R" | "-a" => recursive = true,
                _ if !arg.starts_with('-') => files.push(*arg),
                _ => {}
            }
        }

        if files.len() < 2 {
            return "cp: missing file operand\n".to_string();
        }

        let src = files[files.len() - 2];
        let dst = files[files.len() - 1];

        match vfs.copy(src, dst, recursive) {
            Ok(_) => {
                self.last_exit_code = 0;
                String::new()
            }
            Err(e) => {
                self.last_exit_code = 1;
                format!("cp: cannot copy '{}': {}\n", src, e)
            }
        }
    }

    fn cmd_mv(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        let mut files = Vec::new();
        for arg in args {
            if !arg.starts_with('-') {
                files.push(*arg);
            }
        }

        if files.len() < 2 {
            return "mv: missing file operand\n".to_string();
        }

        let src = files[files.len() - 2];
        let dst = files[files.len() - 1];

        match vfs.rename(src, dst) {
            Ok(_) => {
                self.last_exit_code = 0;
                String::new()
            }
            Err(e) => {
                self.last_exit_code = 1;
                format!("mv: cannot move '{}': {}\n", src, e)
            }
        }
    }

    fn cmd_chmod(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        if args.len() < 2 {
            return "chmod: missing operand\n".to_string();
        }

        let mode = args[0];
        let path = args[1];

        // Parse octal mode (e.g., "755")
        let permissions = u32::from_str_radix(mode.trim_start_matches('0'), 8).unwrap_or(0o755);

        match vfs.chmod(path, permissions) {
            Ok(_) => {
                self.last_exit_code = 0;
                String::new()
            }
            Err(e) => {
                self.last_exit_code = 1;
                format!("chmod: cannot access '{}': {}\n", path, e)
            }
        }
    }

    fn cmd_grep(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut ignore_case = false;
        let mut invert_match = false;
        let mut line_numbers = false;
        let mut pattern = None;
        let mut files = Vec::new();

        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            match *arg {
                "-i" => ignore_case = true,
                "-v" => invert_match = true,
                "-n" => line_numbers = true,
                _ if arg.starts_with('-') => {}
                _ if pattern.is_none() => pattern = Some(*arg),
                _ => files.push(*arg),
            }
        }

        let pattern = match pattern {
            Some(p) => p,
            None => return "grep: missing pattern\n".to_string(),
        };

        if files.is_empty() {
            return "grep: missing file operand\n".to_string();
        }

        let mut output = String::new();
        let search_pattern = if ignore_case {
            pattern.to_lowercase()
        } else {
            pattern.to_string()
        };
        let multiple_files = files.len() > 1;

        for file in files {
            match vfs.read_file(file) {
                Ok(content) => {
                    let text = String::from_utf8_lossy(&content);
                    for (i, line) in text.lines().enumerate() {
                        let search_line = if ignore_case {
                            line.to_lowercase()
                        } else {
                            line.to_string()
                        };

                        let matches = search_line.contains(&search_pattern);
                        if matches != invert_match {
                            if multiple_files {
                                output.push_str(&format!("{}:", file));
                            }
                            if line_numbers {
                                output.push_str(&format!("{}:", i + 1));
                            }
                            output.push_str(line);
                            output.push('\n');
                        }
                    }
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("grep: {}: {}\n", file, e));
                }
            }
        }
        output
    }

    fn cmd_find(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut path = ".";
        let mut name_filter = None;

        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            match *arg {
                _ if !arg.starts_with('-') => path = *arg,
                "-name" => {
                    if let Some(&val) = iter.next() {
                        name_filter = Some(val);
                    }
                }
                _ => {}
            }
        }

        let resolve_path = if path == "." {
            vfs.cwd().to_string()
        } else {
            path.to_string()
        };

        match vfs.find_files(&resolve_path, name_filter) {
            Ok(files) => {
                let mut output = String::new();
                for file in files {
                    output.push_str(&file);
                    output.push('\n');
                }
                self.last_exit_code = 0;
                output
            }
            Err(e) => {
                self.last_exit_code = 1;
                format!("find: '{}': {}\n", path, e)
            }
        }
    }

    fn cmd_head(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut lines = 10;
        let mut files = Vec::new();

        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            if arg.starts_with("-n") || arg.starts_with("--lines") {
                if let Some(val) = arg.split('=').nth(1) {
                    lines = val.parse().unwrap_or(10);
                } else if let Some(next) = iter.next() {
                    lines = next.parse().unwrap_or(10);
                }
            } else if !arg.starts_with('-') {
                files.push(*arg);
            }
        }

        if files.is_empty() {
            return "head: missing file operand\n".to_string();
        }

        let mut output = String::new();
        for file in files {
            match vfs.read_file(file) {
                Ok(content) => {
                    let text = String::from_utf8_lossy(&content);
                    for line in text.lines().take(lines) {
                        output.push_str(line);
                        output.push('\n');
                    }
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("head: {}: {}\n", file, e));
                }
            }
        }
        output
    }

    fn cmd_tail(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut lines = 10;
        let mut files = Vec::new();

        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            if arg.starts_with("-n") || arg.starts_with("--lines") {
                if let Some(val) = arg.split('=').nth(1) {
                    lines = val.parse().unwrap_or(10);
                } else if let Some(next) = iter.next() {
                    lines = next.parse().unwrap_or(10);
                }
            } else if !arg.starts_with('-') {
                files.push(*arg);
            }
        }

        if files.is_empty() {
            return "tail: missing file operand\n".to_string();
        }

        let mut output = String::new();
        for file in files {
            match vfs.read_file(file) {
                Ok(content) => {
                    let text = String::from_utf8_lossy(&content);
                    let all_lines: Vec<&str> = text.lines().collect();
                    let start = if all_lines.len() > lines {
                        all_lines.len() - lines
                    } else {
                        0
                    };
                    for line in &all_lines[start..] {
                        output.push_str(line);
                        output.push('\n');
                    }
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("tail: {}: {}\n", file, e));
                }
            }
        }
        output
    }

    fn cmd_wc(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut files = Vec::new();
        for arg in args {
            if !arg.starts_with('-') {
                files.push(*arg);
            }
        }

        if files.is_empty() {
            return "wc: missing file operand\n".to_string();
        }

        let mut output = String::new();
        let mut total_lines = 0;
        let mut total_words = 0;
        let mut total_chars = 0;
        let file_count = files.len();

        for file in files {
            match vfs.read_file(file) {
                Ok(content) => {
                    let text = String::from_utf8_lossy(&content);
                    let lines = text.lines().count();
                    let words = text.split_whitespace().count();
                    let chars = text.chars().count();

                    output.push_str(&format!("{} {} {} {}\n", lines, words, chars, file));
                    total_lines += lines;
                    total_words += words;
                    total_chars += chars;
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("wc: {}: {}\n", file, e));
                }
            }
        }

        if file_count > 1 {
            output.push_str(&format!(
                "{} {} {} total\n",
                total_lines, total_words, total_chars
            ));
        }
        output
    }

    fn cmd_sort(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut reverse = false;
        let mut unique = false;
        let mut files = Vec::new();

        for arg in args {
            match *arg {
                "-r" => reverse = true,
                "-u" => unique = true,
                _ if !arg.starts_with('-') => files.push(*arg),
                _ => {}
            }
        }

        if files.is_empty() {
            return "sort: missing file operand\n".to_string();
        }

        let mut output = String::new();
        for file in files {
            match vfs.read_file(file) {
                Ok(content) => {
                    let text = String::from_utf8_lossy(&content);
                    let mut lines: Vec<&str> = text.lines().collect();
                    lines.sort();
                    if reverse {
                        lines.reverse();
                    }
                    if unique {
                        lines.dedup();
                    }
                    for line in lines {
                        output.push_str(line);
                        output.push('\n');
                    }
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("sort: {}: {}\n", file, e));
                }
            }
        }
        output
    }

    fn cmd_uniq(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut files = Vec::new();
        for arg in args {
            if !arg.starts_with('-') {
                files.push(*arg);
            }
        }

        if files.is_empty() {
            return "uniq: missing file operand\n".to_string();
        }

        let mut output = String::new();
        for file in files {
            match vfs.read_file(file) {
                Ok(content) => {
                    let text = String::from_utf8_lossy(&content);
                    let mut prev: Option<&str> = None;
                    for line in text.lines() {
                        if Some(line) != prev {
                            output.push_str(line);
                            output.push('\n');
                        }
                        prev = Some(line);
                    }
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("uniq: {}: {}\n", file, e));
                }
            }
        }
        output
    }

    fn cmd_date(&self) -> String {
        use chrono::Local;
        let now = Local::now();
        format!("{}\n", now.format("%a %b %d %H:%M:%S %Y %Z"))
    }

    fn cmd_env(&mut self, args: &[&str]) -> String {
        if args.is_empty() {
            let mut output = String::new();
            let mut keys: Vec<&String> = self.env.keys().collect();
            keys.sort();
            for key in keys {
                if let Some(value) = self.env.get(key) {
                    output.push_str(&format!("{}={}\n", key, value));
                }
            }
            output
        } else {
            // env VAR - get specific variable
            match self.env.get(args[0]) {
                Some(val) => format!("{}\n", val),
                None => String::new(),
            }
        }
    }

    fn cmd_export(&mut self, args: &[&str]) -> String {
        if args.is_empty() {
            return self.cmd_env(&[]);
        }

        for arg in args {
            if let Some(eq_pos) = arg.find('=') {
                let key = &arg[..eq_pos];
                let value = &arg[eq_pos + 1..];
                self.env.insert(key.to_string(), value.to_string());
            } else {
                // Just mark as exported (value empty)
                self.env.insert(arg.to_string(), String::new());
            }
        }
        self.last_exit_code = 0;
        String::new()
    }

    fn cmd_unset(&mut self, args: &[&str]) -> String {
        for arg in args {
            self.env.remove(*arg);
        }
        self.last_exit_code = 0;
        String::new()
    }

    fn cmd_alias(&mut self, args: &[&str]) -> String {
        if args.is_empty() {
            // List all aliases
            let mut output = String::new();
            let mut keys: Vec<&String> = self.aliases.keys().collect();
            keys.sort();
            for key in keys {
                if let Some(value) = self.aliases.get(key) {
                    output.push_str(&format!("alias {}='{}'\n", key, value));
                }
            }
            if output.is_empty() {
                output.push_str("No aliases defined\n");
            }
            output
        } else {
            // Set alias
            for arg in args {
                if let Some(eq_pos) = arg.find('=') {
                    let key = &arg[..eq_pos];
                    let value = &arg[eq_pos + 1..].trim_matches('\'').trim_matches('"');
                    if self.aliases.len() < MAX_ALIASES {
                        self.aliases.insert(key.to_string(), value.to_string());
                    } else {
                        return "alias: maximum alias limit reached\n".to_string();
                    }
                } else {
                    return format!("alias: {}: invalid format (use name=value)\n", arg);
                }
            }
            self.last_exit_code = 0;
            String::new()
        }
    }

    fn cmd_unalias(&mut self, args: &[&str]) -> String {
        for arg in args {
            if self.aliases.remove(*arg).is_none() {
                self.last_exit_code = 1;
                return format!("unalias: {}: not found\n", arg);
            }
        }
        self.last_exit_code = 0;
        String::new()
    }

    fn cmd_history(&mut self) -> String {
        let mut output = String::new();
        for (i, cmd) in self.history.iter().enumerate() {
            output.push_str(&format!("{:>5}  {}\n", i + 1, cmd));
        }
        output
    }

    fn cmd_which(&mut self, args: &[&str]) -> String {
        let mut output = String::new();
        for arg in args {
            // Check if it's a built-in command
            let builtins = vec![
                "ls", "cd", "pwd", "cat", "echo", "mkdir", "touch", "rm", "cp", "mv", "chmod",
                "grep", "find", "head", "tail", "wc", "sort", "uniq", "ps", "kill", "whoami",
                "uname", "date", "env", "export", "unset", "alias", "history", "clear", "help",
                "which", "file", "stat",
            ];

            if builtins.contains(&arg) {
                output.push_str(&format!("{} is a shell builtin\n", arg));
            } else if self.aliases.contains_key(*arg) {
                output.push_str(&format!("{}: aliased to '{}'\n", arg, self.aliases[*arg]));
            } else {
                // Check PATH
                if let Some(path) = self.env.get("PATH") {
                    let mut found = false;
                    for dir in path.split(':') {
                        let full_path = format!("{}/{}", dir, arg);
                        // Would need to check if file exists in VFS
                        // For now, just show the path
                        output.push_str(&format!("{}/{}\n", dir, arg));
                        found = true;
                    }
                    if !found {
                        output.push_str(&format!("{} not found\n", arg));
                    }
                } else {
                    output.push_str(&format!("{} not found\n", arg));
                }
            }
        }
        output
    }

    fn cmd_file(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut output = String::new();
        for arg in args.iter().filter(|&&a| !a.starts_with('-')) {
            match vfs.get_file_info(arg) {
                Ok(info) => {
                    let file_type = match info.file_type {
                        crate::virtual_fs::FileType::File => "regular file",
                        crate::virtual_fs::FileType::Directory => "directory",
                        crate::virtual_fs::FileType::Symlink => "symbolic link",
                        crate::virtual_fs::FileType::CharDevice => "character device",
                        crate::virtual_fs::FileType::BlockDevice => "block device",
                    };
                    output.push_str(&format!("{}: {} ({} bytes)\n", arg, file_type, info.size));
                }
                Err(_) => {
                    output.push_str(&format!(
                        "{}: cannot open (No such file or directory)\n",
                        arg
                    ));
                }
            }
        }
        output
    }

    fn cmd_stat(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut output = String::new();
        for arg in args.iter().filter(|&&a| !a.starts_with('-')) {
            match vfs.get_file_info(arg) {
                Ok(info) => {
                    output.push_str(&format!("  File: {}\n", arg));
                    output.push_str(&format!("  Size: {} bytes\n", info.size));
                    output.push_str(&format!("  Type: {:?}\n", info.file_type));
                    output.push_str(&format!("  Permissions: {:o}\n", info.permissions));
                    output.push_str(&format!("  Executable: {}\n", info.executable));
                    output.push('\n');
                }
                Err(e) => {
                    output.push_str(&format!("stat: cannot stat '{}': {}\n", arg, e));
                }
            }
        }
        output
    }

    fn cmd_kill(&mut self, args: &[&str], processes: &mut ProcessManager) -> String {
        if args.is_empty() {
            return "kill: missing operand\n".to_string();
        }

        let mut output = String::new();
        for arg in args.iter().filter(|&&a| !a.starts_with('-')) {
            match processes.stop_process(arg) {
                Ok(_) => {
                    self.last_exit_code = 0;
                    output.push_str(&format!("Process {} terminated\n", arg));
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("kill: {}: {}\n", arg, e));
                }
            }
        }
        output
    }

    fn cmd_uname(&mut self, args: &[&str]) -> String {
        let mut show_all = false;
        for arg in args {
            if *arg == "-a" || *arg == "--all" {
                show_all = true;
                break;
            }
        }

        if show_all {
            "Linux trymon 6.19.12-trymon #1 SMP PREEMPT WASM x86_64 GNU/Linux\n".to_string()
        } else {
            "Linux\n".to_string()
        }
    }

    fn cmd_ps(&mut self, processes: &ProcessManager) -> String {
        let procs = processes.list_processes();
        let mut output = String::from("  PID  PPID NAME         STATE        MEMORY\n");
        for p in procs {
            output.push_str(&format!(
                "{:>5} {:>5} {: <12} {: <12} {} bytes\n",
                p.pid,
                p.ppid.as_deref().unwrap_or("?"),
                p.name,
                format!("{:?}", p.state),
                p.memory_usage
            ));
        }
        output
    }

    fn cmd_status(&mut self, processes: &ProcessManager, vfs: &VirtualFileSystem) -> String {
        let stats = vfs.stats();
        let mut output = String::from("\x1b[1;36m--- TRYMON KERNEL STATUS ---\x1b[0m\n");
        output.push_str(&format!("  Processes: {}\n", processes.running_count()));
        output.push_str(&format!(
            "  Memory:    {} bytes\n",
            processes.memory_usage()
        ));
        output.push_str(&format!(
            "  VFS Files: {} files, {} dirs\n",
            stats.total_files, stats.total_directories
        ));
        output.push_str(&format!("  VFS Size:  {} bytes\n", stats.total_size));
        output.push_str("\x1b[1;36m----------------------------\x1b[0m\n");
        output
    }

    fn cmd_source(
        &self,
        args: &[&str],
        vfs: &mut VirtualFileSystem,
        processes: &mut ProcessManager,
        loader: &BinaryLoader,
    ) -> String {
        if args.is_empty() {
            return "source: missing file operand\n".to_string();
        }

        let file_path = args[0];
        match vfs.read_file(file_path) {
            Ok(content) => {
                let script = String::from_utf8_lossy(&content);
                let mut output = String::new();

                // Execute each line as a command
                for line in script.lines() {
                    let line = line.trim();
                    if !line.is_empty() && !line.starts_with('#') {
                        // Note: This is simplified - doesn't handle multi-line commands
                        // For a proper implementation, we'd need to use self.execute_command
                        // but that requires &mut self which we can't have here
                        output.push_str(&format!("Executing: {}\n", line));
                    }
                }
                output
            }
            Err(e) => format!("source: {}: {}\n", file_path, e),
        }
    }

    fn cmd_seq(&mut self, args: &[&str]) -> String {
        if args.is_empty() {
            return "seq: missing operand\n".to_string();
        }

        let start: i64 = if args.len() > 1 {
            args[0].parse().unwrap_or(1)
        } else {
            1
        };

        let end: i64 = if args.len() > 1 {
            args[1]
                .parse()
                .unwrap_or_else(|_| args[0].parse().unwrap_or(1))
        } else {
            args[0].parse().unwrap_or(1)
        };

        let mut output = String::new();
        for i in start..=end {
            output.push_str(&format!("{}\n", i));
        }
        output
    }

    fn cmd_tee(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        // Simplified tee implementation
        // In a real implementation, this would read from stdin and write to file(s) and stdout
        let mut files = Vec::new();
        let mut append = false;

        for arg in args {
            match *arg {
                "-a" => append = true,
                _ if !arg.starts_with('-') => files.push(*arg),
                _ => {}
            }
        }

        // For now, just create the files
        let mut output = String::new();
        for file in files {
            if append {
                // Would append in real implementation
                vfs.create_empty_file(file).ok();
            } else {
                vfs.create_empty_file(file).ok();
            }
        }
        output
    }

    fn cmd_xargs(
        &self,
        args: &[&str],
        vfs: &mut VirtualFileSystem,
        processes: &mut ProcessManager,
        loader: &BinaryLoader,
    ) -> String {
        if args.is_empty() {
            return "xargs: missing command operand\n".to_string();
        }

        let cmd = args[0];
        let cmd_args = &args[1..];

        // In real implementation, would read from stdin and execute command
        // For now, just show what would be done
        format!("xargs: would execute: {} {}\n", cmd, cmd_args.join(" "))
    }

    fn cmd_basename(&mut self, args: &[&str]) -> String {
        if args.is_empty() {
            return "basename: missing operand\n".to_string();
        }

        let path = args[0];
        let suffix = if args.len() > 1 { args[1] } else { "" };

        let name = path.split('/').last().unwrap_or(path);
        let name = if !suffix.is_empty() && name.ends_with(suffix) {
            &name[..name.len() - suffix.len()]
        } else {
            name
        };

        format!("{}\n", name)
    }

    fn cmd_dirname(&mut self, args: &[&str]) -> String {
        if args.is_empty() {
            return "dirname: missing operand\n".to_string();
        }

        let path = args[0];
        let dir = path.rfind('/').map(|i| &path[..i]).unwrap_or(".");
        format!("{}\n", if dir.is_empty() { "." } else { dir })
    }

    fn cmd_realpath(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut output = String::new();
        for arg in args.iter().filter(|&&a| !a.starts_with('-')) {
            // Simplified - would resolve symlinks in real implementation
            let resolved = if arg.starts_with('/') {
                arg.to_string()
            } else {
                format!("{}/{}", vfs.cwd(), arg)
            };
            output.push_str(&format!("{}\n", resolved));
        }
        output
    }

    fn cmd_ln(&mut self, args: &[&str], vfs: &mut VirtualFileSystem) -> String {
        let mut symbolic = false;
        let mut files = Vec::new();

        for arg in args {
            match *arg {
                "-s" => symbolic = true,
                _ if !arg.starts_with('-') => files.push(*arg),
                _ => {}
            }
        }

        if files.len() < 2 {
            return "ln: missing file operand\n".to_string();
        }

        let target = files[files.len() - 2];
        let link_name = files[files.len() - 1];

        if symbolic {
            match vfs.create_symlink(link_name, target) {
                Ok(_) => {
                    self.last_exit_code = 0;
                    String::new()
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    format!(
                        "ln: failed to create symbolic link '{}': {}\n",
                        link_name, e
                    )
                }
            }
        } else {
            // Hard link
            match vfs.create_hard_link(link_name, target) {
                Ok(_) => {
                    self.last_exit_code = 0;
                    String::new()
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    format!("ln: failed to create link '{}': {}\n", link_name, e)
                }
            }
        }
    }

    fn cmd_readlink(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut output = String::new();
        for arg in args.iter().filter(|&&a| !a.starts_with('-')) {
            match vfs.read_symlink(arg) {
                Ok(target) => {
                    output.push_str(&format!("{}\n", target));
                    self.last_exit_code = 0;
                }
                Err(e) => {
                    self.last_exit_code = 1;
                    output.push_str(&format!("readlink: {}: {}\n", arg, e));
                }
            }
        }
        output
    }

    fn cmd_tree(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let path = args.get(0).copied().unwrap_or(".");
        let resolve_path = if path == "." {
            vfs.cwd().to_string()
        } else {
            path.to_string()
        };

        let mut output = format!("{}\n", resolve_path);
        match self.tree_recursive(vfs, &resolve_path, 0, &mut output) {
            Ok(_) => {
                output.push('\n');
                self.last_exit_code = 0;
            }
            Err(e) => {
                output.push_str(&format!("tree: {}: {}\n", path, e));
                self.last_exit_code = 1;
            }
        }
        output
    }

    fn tree_recursive(
        &self,
        vfs: &VirtualFileSystem,
        path: &str,
        depth: usize,
        output: &mut String,
    ) -> Result<()> {
        let files = vfs.list_directory(path)?;
        let count = files.len();

        for (i, file) in files.iter().enumerate() {
            let is_last = i == count - 1;
            let prefix = if is_last { "└── " } else { "├── " };

            for _ in 0..depth {
                output.push_str("│   ");
            }
            output.push_str(prefix);

            let color = if file.file_type == crate::virtual_fs::FileType::Directory {
                "\x1b[1;34m"
            } else if file.executable {
                "\x1b[1;32m"
            } else {
                "\x1b[0m"
            };

            output.push_str(color);
            output.push_str(&file.name);
            output.push_str("\x1b[0m\n");

            if file.file_type == crate::virtual_fs::FileType::Directory {
                let full_path = if path.ends_with('/') {
                    format!("{}{}", path, file.name)
                } else {
                    format!("{}/{}", path, file.name)
                };
                self.tree_recursive(vfs, &full_path, depth + 1, output)?;
            }
        }

        Ok(())
    }

    fn cmd_du(&mut self, args: &[&str], vfs: &VirtualFileSystem) -> String {
        let mut summarize = false;
        let mut human_readable = false;
        let mut paths = Vec::new();

        for arg in args {
            match *arg {
                "-s" => summarize = true,
                "-h" => human_readable = true,
                _ if !arg.starts_with('-') => paths.push(*arg),
                _ => {}
            }
        }

        if paths.is_empty() {
            paths.push(vfs.cwd());
        }

        let mut output = String::new();
        for path in paths {
            match vfs.get_file_info(path) {
                Ok(info) => {
                    let size = if human_readable {
                        format_size_human(info.size as u64)
                    } else {
                        format!("{}", info.size)
                    };
                    if summarize {
                        output.push_str(&format!("{}\t{}\n", size, path));
                    } else {
                        // Would recursively calculate size in real impl
                        output.push_str(&format!("{}\t{}\n", size, path));
                    }
                }
                Err(e) => {
                    output.push_str(&format!("du: cannot access '{}': {}\n", path, e));
                }
            }
        }
        output
    }

    fn cmd_df(&mut self, vfs: &VirtualFileSystem) -> String {
        let stats = vfs.stats();
        let total = stats.total_size;
        let used = total / 2; // Simplified
        let available = total - used;
        let use_percent = if total > 0 {
            (used as f64 / total as f64 * 100.0) as u64
        } else {
            0
        };

        format!(
            "Filesystem     1K-blocks    Used Available Use% Mounted on\n\
             trymon-fs      {:>10} {:>10} {:>10}  {:>2}% /\n",
            total / 1024,
            used / 1024,
            available / 1024,
            use_percent
        )
    }

    fn cmd_free(&mut self, processes: &ProcessManager) -> String {
        let total_mem = 128 * 1024 * 1024; // 128 MB default
        let used_mem = processes.memory_usage();
        let free_mem = total_mem - used_mem;

        format!(
            "              total        used        free\n\
             Mem:      {:>10} {:>10} {:>10}\n",
            total_mem, used_mem, free_mem
        )
    }

    fn cmd_uptime(&mut self, processes: &ProcessManager) -> String {
        // Simplified uptime display
        format!(
            " {} up, 0 users, load average: {:.2}, {:.2}, {:.2}\n",
            processes.running_count(),
            0.1,
            0.05,
            0.01
        )
    }

    fn cmd_id(&self) -> String {
        format!("uid=0(root) gid=0(root) groups=0(root)\n")
    }

    fn cmd_yes(&mut self, args: &[&str]) -> String {
        // Just output y once (in real implementation would be infinite)
        if args.is_empty() {
            "y\n".to_string()
        } else {
            format!("{}\n", args.join(" "))
        }
    }
}

/// Helper function to format size in human-readable form
fn format_size_human(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1}G", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1}M", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1}K", bytes as f64 / 1024.0)
    } else {
        format!("{}B", bytes)
    }
}
