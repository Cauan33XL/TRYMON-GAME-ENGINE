/* tslint:disable */
/* eslint-disable */

/**
 * Begin a filesystem transaction
 */
export function api_begin_transaction(operation: string): void;

/**
 * Check file permissions
 */
export function api_check_permissions(path: string, uid: number, gid: number, required: number): boolean;

/**
 * Commit the current filesystem transaction
 */
export function api_commit_transaction(): void;

/**
 * Create a new directory
 */
export function api_create_directory(path: string): string;

/**
 * Create a pipe between two processes
 */
export function api_create_pipe(reader_pid: string, writer_pid: string): string;

/**
 * Execute a loaded binary
 */
export function api_execute_binary(binary_id: string, _args: string): string;

/**
 * Get process output
 */
export function api_get_output(pid: string): string;

/**
 * Get kernel status
 */
export function api_get_status(): string;

/**
 * Get the full system state including boot logs
 */
export function api_get_system_state(): string;

/**
 * Initialize kernel with configuration
 */
export function api_kernel_init(config_json: string): string;

/**
 * Kill a process immediately
 */
export function api_kill_process(pid: string): void;

/**
 * List files in a directory
 */
export function api_list_dir(path: string): string;

/**
 * List all processes
 */
export function api_list_processes(): string;

/**
 * Load and register a binary
 */
export function api_load_binary(name: string, data: Uint8Array): string;

/**
 * Mount a filesystem
 */
export function api_mount(path: string, source: string, fs_type: string): void;

/**
 * Read a file's content
 */
export function api_read_file(path: string): Uint8Array;

/**
 * Read data from a pipe
 */
export function api_read_from_pipe(pipe_id: string, max_bytes: number): Uint8Array;

/**
 * Resolve a path (handles ./, ../, ~, symlinks)
 */
export function api_resolve_path(path: string): string;

/**
 * Rollback the current filesystem transaction
 */
export function api_rollback_transaction(): void;

/**
 * Send input to a process
 */
export function api_send_input(pid: string, input: string): void;

/**
 * Send a signal to a process
 */
export function api_send_signal(pid: string, signal_num: number): void;

/**
 * Get the current shell prompt
 */
export function api_shell_get_prompt(): string;

/**
 * Send input to the interactive shell
 */
export function api_shell_input(input: string): string;

/**
 * Stop a running process
 */
export function api_stop_process(pid: string): void;

/**
 * Tick the kernel (call periodically for process updates)
 */
export function api_tick(): void;

/**
 * Unmount a filesystem
 */
export function api_unmount(path: string): void;

/**
 * Get VFS statistics
 */
export function api_vfs_stats(): string;

/**
 * Write data to a file (creates if not exists)
 */
export function api_write_file(path: string, data: Uint8Array): string;

/**
 * Write data to a pipe
 */
export function api_write_to_pipe(pipe_id: string, data: Uint8Array): void;

/**
 * Execute a loaded binary
 */
export function kernel_execute_binary(binary_id: string): string;

/**
 * Export the current VFS state as a JSON string
 */
export function kernel_export_vfs(): string;

/**
 * Get terminal output from a process
 */
export function kernel_get_output(process_id: string): string;

/**
 * Import a VFS state from a JSON string
 */
export function kernel_import_vfs(json: string): void;

/**
 * Initialize the TRYMON kernel
 */
export function kernel_init(): void;

/**
 * List all running processes
 */
export function kernel_list_processes(): string;

/**
 * Load a binary file into the kernel
 */
export function kernel_load_binary(name: string, data: Uint8Array): string;

/**
 * Send input to a process
 */
export function kernel_send_input(process_id: string, input: string): void;

/**
 * Get kernel status
 */
export function kernel_status(): string;

/**
 * Stop a running process
 */
export function kernel_stop_process(process_id: string): void;

/**
 * Install a loaded .trymon package
 */
export function kernel_trymon_install(binary_id: string): string;

/**
 * List all installed Trymon apps
 */
export function kernel_trymon_list_apps(): string;

/**
 * Run an installed Trymon app
 */
export function kernel_trymon_run_app(app_id: string): string;

/**
 * Execute a .trymon package directly (Execute mode)
 */
export function trymon_execute_package(binary_id: string): string;

/**
 * Install a TVM bytecode package (Install mode)
 */
export function trymon_install_tvm(package_id: string, name: string): string;

/**
 * Compile ELF binary to TVM bytecode
 */
export function tvm_compile_elf(elf_data: Uint8Array, name: string): string;

/**
 * Execute a loaded TVM package
 */
export function tvm_execute(package_id: string): string;

/**
 * Export a loaded TVM package as .trymon binary data (returns base64)
 */
export function tvm_export_package(package_id: string): Uint8Array;

/**
 * Initialize the TVM subsystem
 */
export function tvm_init(): void;

/**
 * Check if TVM is initialized
 */
export function tvm_is_initialized(): boolean;

/**
 * Load a TVM bytecode package (.trymon format v2)
 */
export function tvm_load(data: Uint8Array): string;

/**
 * Get TVM sandbox status
 */
export function tvm_sandbox_status(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly api_begin_transaction: (a: number, b: number) => void;
    readonly api_check_permissions: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly api_commit_transaction: () => [number, number];
    readonly api_create_directory: (a: number, b: number) => [number, number, number, number];
    readonly api_create_pipe: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly api_execute_binary: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly api_get_output: (a: number, b: number) => [number, number];
    readonly api_get_status: () => [number, number];
    readonly api_get_system_state: () => [number, number];
    readonly api_kernel_init: (a: number, b: number) => [number, number, number, number];
    readonly api_kill_process: (a: number, b: number) => [number, number];
    readonly api_list_dir: (a: number, b: number) => [number, number];
    readonly api_list_processes: () => [number, number];
    readonly api_load_binary: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly api_mount: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly api_read_file: (a: number, b: number) => [number, number, number, number];
    readonly api_read_from_pipe: (a: number, b: number, c: number) => [number, number, number, number];
    readonly api_resolve_path: (a: number, b: number) => [number, number, number, number];
    readonly api_rollback_transaction: () => [number, number];
    readonly api_send_input: (a: number, b: number, c: number, d: number) => [number, number];
    readonly api_send_signal: (a: number, b: number, c: number) => [number, number];
    readonly api_shell_get_prompt: () => [number, number];
    readonly api_shell_input: (a: number, b: number) => [number, number];
    readonly api_stop_process: (a: number, b: number) => [number, number];
    readonly api_tick: () => void;
    readonly api_unmount: (a: number, b: number) => [number, number];
    readonly api_vfs_stats: () => [number, number];
    readonly api_write_file: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly api_write_to_pipe: (a: number, b: number, c: number, d: number) => [number, number];
    readonly kernel_execute_binary: (a: number, b: number) => [number, number, number, number];
    readonly kernel_export_vfs: () => [number, number, number, number];
    readonly kernel_import_vfs: (a: number, b: number) => [number, number];
    readonly kernel_init: () => [number, number];
    readonly kernel_load_binary: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly kernel_status: () => [number, number];
    readonly kernel_trymon_install: (a: number, b: number) => [number, number, number, number];
    readonly kernel_trymon_list_apps: () => [number, number];
    readonly kernel_trymon_run_app: (a: number, b: number) => [number, number, number, number];
    readonly trymon_execute_package: (a: number, b: number) => [number, number, number, number];
    readonly trymon_install_tvm: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tvm_compile_elf: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tvm_execute: (a: number, b: number) => [number, number, number, number];
    readonly tvm_export_package: (a: number, b: number) => [number, number, number, number];
    readonly tvm_init: () => [number, number];
    readonly tvm_is_initialized: () => number;
    readonly tvm_load: (a: number, b: number) => [number, number, number, number];
    readonly tvm_sandbox_status: () => [number, number];
    readonly kernel_stop_process: (a: number, b: number) => [number, number];
    readonly kernel_get_output: (a: number, b: number) => [number, number];
    readonly kernel_send_input: (a: number, b: number, c: number, d: number) => [number, number];
    readonly kernel_list_processes: () => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
