/* tslint:disable */
/* eslint-disable */

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
 * Initialize kernel with configuration
 */
export function api_kernel_init(config_json: string): string;

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
 * Send input to a process
 */
export function api_send_input(pid: string, input: string): void;

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
 * Execute a loaded binary
 */
export function kernel_execute_binary(binary_id: string): string;

/**
 * Get terminal output from a process
 */
export function kernel_get_output(process_id: string): string;

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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly api_execute_binary: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly api_get_output: (a: number, b: number) => [number, number];
    readonly api_get_status: () => [number, number];
    readonly api_kernel_init: (a: number, b: number) => [number, number, number, number];
    readonly api_list_dir: (a: number, b: number) => [number, number];
    readonly api_list_processes: () => [number, number];
    readonly api_load_binary: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly api_mount: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly api_read_file: (a: number, b: number) => [number, number, number, number];
    readonly api_send_input: (a: number, b: number, c: number, d: number) => [number, number];
    readonly api_shell_get_prompt: () => [number, number];
    readonly api_shell_input: (a: number, b: number) => [number, number];
    readonly api_stop_process: (a: number, b: number) => [number, number];
    readonly api_tick: () => void;
    readonly api_unmount: (a: number, b: number) => [number, number];
    readonly kernel_execute_binary: (a: number, b: number) => [number, number, number, number];
    readonly kernel_init: () => [number, number];
    readonly kernel_load_binary: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly kernel_status: () => [number, number];
    readonly kernel_trymon_install: (a: number, b: number) => [number, number, number, number];
    readonly kernel_trymon_list_apps: () => [number, number];
    readonly kernel_trymon_run_app: (a: number, b: number) => [number, number, number, number];
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
