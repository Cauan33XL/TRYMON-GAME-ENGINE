/**
 * Kernel Service — Single Source of Truth for Trymon OS
 * 
 * This singleton initializes the Rust kernel WASM module BEFORE any UI renders.
 * The frontend is purely a view layer on top of kernel state.
 * 
 * Lifecycle:
 *   1. import → WASM loads
 *   2. init() → kernel subsystems start
 *   3. restoreVFS() → previous state from IndexedDB
 *   4. ready → frontend can render
 */

import * as rust from '@wasm/pkg/trymon_kernel_rust.js';
import { loadVFS, saveVFS } from './persistence';
import { V86Emulator, type BinaryFile, type ExecutionResult as V86ExecutionResult } from '../../wasm/v86-emulator';

// ============================================================
// Types (mirror of kernel Rust structures)
// ============================================================

export interface BinaryInfo {
  id: string;
  name: string;
  format: 'AppImage' | 'deb' | 'rpm' | 'ELF' | 'Trymon' | 'Unknown';
  size: number;
  entry_point: string | null;
  extracted_files: string[];
  status: 'Ready' | 'Loading' | { Error: string };
  metadata: PackageMetadata | null;
}

export interface PackageMetadata {
  name: string | null;
  version: string | null;
  architecture: string | null;
  description: string | null;
  maintainer: string | null;
  dependencies: string[];
  icon: string | null;
  entry: string | null;
}

export interface ProcessInfo {
  pid: string;
  name: string;
  binary_id: string;
  state: 'Running' | 'Stopped' | 'Exited' | 'Crashed' | 'Zombie';
  exit_code: number | null;
  ppid: string | null;
  children: string[];
  memory_usage: number;
  cpu_usage: number;
  start_time: number;
  end_time: number | null;
  cwd: string;
  env: Record<string, string>;
  argv: string[];
  stdout: string;
  stderr: string;
}

export interface VfsStats {
  total_files: number;
  total_directories: number;
  total_size: number;
  mount_points: number;
}

export type SystemState = 'Booting' | 'Ready' | 'Running' | 'ShuttingDown' | 'Halted';

export interface KernelState {
  initialized: boolean;
  uptime: number;
  loaded_binaries: BinaryInfo[];
  running_processes: ProcessInfo[];
  memory_usage_bytes: number;
  filesystem_stats: VfsStats | null;
  state: SystemState;
  boot_logs: string[];
  tvm_error?: string;
  tvm_ready?: boolean;
}

export type KernelUpdateCallback = (state: KernelState) => void;


// ============================================================
// Singleton State
// ============================================================

let _kernelReady = false;
let _kernelState: KernelState | null = null;
const _updateCallbacks: KernelUpdateCallback[] = [];

let _tickInterval: ReturnType<typeof setInterval> | null = null;
let _autoSaveInterval: ReturnType<typeof setInterval> | null = null;

// v86 Emulator instance for real Linux execution
let _v86Emulator: V86Emulator | null = null;
let _v86Ready = false;

// ============================================================
// Core API
// ============================================================

/**
 * Initialize the kernel. Must be called ONCE before any UI renders.
 * Returns the initial kernel state.
 */
let _isInitializing = false;

/**
 * Initialize the kernel. Must be called ONCE before any UI renders.
 * Returns the initial kernel state.
 */
export async function init(): Promise<KernelState> {
  if (_kernelReady) return getState();
  if (_isInitializing) return getState();

  _isInitializing = true;
  console.log('[KernelService] Loading WASM module...');

  // Initialize wasm-pack module
  if (typeof rust.default === 'function') {
    await rust.default();
  }

  console.log('[KernelService] Initializing kernel subsystems...');

  // Set initial state
  _kernelState = getState();

  // Call kernel init. This is a synchronous WASM call.
  try {
    rust.api_kernel_init('{}');
    console.log('[KernelService] Kernel API call returned.');

    // Stabilization sequence for UX (ensures person can see logs)
    return new Promise((resolve) => {
      let step = 0;
      const stabilization = [
        { msg: "Probing virtual motherboard... [OK]", delay: 500 },
        { msg: "Checking system memory layout... (128MB detected)", delay: 950 },
        { msg: "Scanning virtual PCI bus artifacts...", delay: 625 },
        { msg: "Establishing secure-boot handshake...", delay: 625 },
        { msg: "Searching for storage devices... [VFS_READY]", delay: 500 },
        { msg: "Initializing Trymon WASM Core v4.5.1...", delay: 750 },
        { msg: "Loading system shell & user services...", delay: 1050 }
      ];

      const runStabilization = () => {
        if (step < stabilization.length) {
          const s = stabilization[step];
          const realState = getState();

          // Force UI update during stabilization
          _kernelState = {
            ...realState,
            state: 'Booting', // Keep it in 'Booting' while we show our messages
            boot_logs: [...realState.boot_logs, s.msg]
          };
          _updateCallbacks.forEach(cb => cb(_kernelState!));

          setTimeout(() => {
            step++;
            runStabilization();
          }, s.delay);
        } else {
          // Finish line
          const finalState = getState();
          _kernelState = finalState;

          console.log('[KernelService] Boot sequence complete.');

          // Restore VFS state from persistence
          loadVFS().then(savedVFS => {
            if (savedVFS) {
              console.log('[KernelService] Restoring VFS state...');
              try {
                rust.kernel_import_vfs(savedVFS);
              } catch (e) {
                console.warn('[KernelService] VFS Restore failed (non-fatal):', e);
              }
            }
          }).catch(e => console.warn('[KernelService] VFS Restore failed:', e));

          _kernelReady = true;
          _isInitializing = false;
          _startTickLoop();
          _startAutoSave();

          // Seed Virtual Web Content
          seedVirtualWeb();

          // Initialize Trymord Backend
          initTrymordBackend();

          // Initialize TVM (Trymon Virtual Machine)
          try {
            console.log('[KernelService] Initializing TVM...');
            rust.tvm_init();
            console.log('[KernelService] TVM initialized successfully');
            _kernelState = {
              ..._kernelState!,
              tvm_ready: true
            };
          } catch (e) {
            console.error('[KernelService] TVM init failed:', e);
            _kernelState = {
              ..._kernelState!,
              tvm_error: `TVM initialization failed: ${e}`
            };
          }

          // Final notify
          console.log('[KernelService] Notifying callbacks, state:', _kernelState?.state);
          _updateCallbacks.forEach(cb => cb(_kernelState!));
          resolve(_kernelState!);
        }
      };

      runStabilization();
    });

  } catch (error) {
    console.error('[KernelService] Fatal init error:', error);
    _isInitializing = false;
    _kernelState = {
      ...getState(),
      state: 'Halted',
      boot_logs: [...(getState().boot_logs), `FATAL ERROR: ${error}`]
    };
    _updateCallbacks.forEach(cb => cb(_kernelState!));
    throw error;
  }
}



/**
 * Check if kernel is ready (synchronous)
 */
export function isReady(): boolean {
  return _kernelReady;
}

/**
 * Register a callback to be called when kernel is ready.
 * If already ready, callback is called immediately.
 */
export function onUpdate(callback: KernelUpdateCallback): () => void {
  if (_kernelState) {
    callback(_kernelState);
  }

  _updateCallbacks.push(callback);

  // Return unsubscribe function
  return () => {
    const idx = _updateCallbacks.indexOf(callback);
    if (idx >= 0) _updateCallbacks.splice(idx, 1);
  };
}


/**
 * Get current kernel state (synchronous snapshot)
 */
export function getState(): KernelState {
  try {
    const status = JSON.parse(rust.api_get_status());
    return {
      initialized: status.initialized,
      uptime: status.uptime,
      loaded_binaries: status.loaded_binaries || [],
      running_processes: listProcesses(),
      memory_usage_bytes: status.memory_usage_bytes,
      filesystem_stats: status.filesystem_stats,
      state: status.state,
      boot_logs: status.boot_logs || [],
      tvm_ready: _kernelState?.tvm_ready || false,
      tvm_error: _kernelState?.tvm_error,
    };
  } catch {
    return {
      initialized: false,
      uptime: 0,
      loaded_binaries: [],
      running_processes: [],
      memory_usage_bytes: 0,
      filesystem_stats: null,
      state: 'Booting' as SystemState,
      boot_logs: [],
      tvm_ready: false,
      tvm_error: undefined,
    };
  }
}


// ============================================================
// Binary Management (delegates to kernel)
// ============================================================

export function loadBinary(name: string, data: Uint8Array): BinaryInfo {
  assertReady();
  const result = rust.api_load_binary(name, data);
  return JSON.parse(result);
}

export function executeBinary(binaryId: string, args: string = ''): ProcessInfo {
  assertReady();
  const result = rust.api_execute_binary(binaryId, args);
  return JSON.parse(result);
}

export function listBinaries(): BinaryInfo[] {
  if (!_kernelReady) return [];
  try {
    const status = JSON.parse(rust.api_get_status());
    return status.loaded_binaries || [];
  } catch {
    return [];
  }
}

export function removeBinary(_binaryId: string): void {
  assertReady();
  // Note: kernel doesn't have a remove_binary API yet
  // This would need to be added to lib.rs
  console.warn('[KernelService] removeBinary not yet implemented in kernel');
}

// ============================================================
// Process Management
// ============================================================

export function listProcesses(): ProcessInfo[] {
  if (!_kernelReady) return [];
  try {
    const result = rust.api_list_processes();
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export function stopProcess(pid: string): void {
  assertReady();
  rust.api_stop_process(pid);
}

export function killProcess(pid: string): void {
  assertReady();
  rust.api_kill_process(pid);
}

export function sendInput(pid: string, input: string): void {
  assertReady();
  rust.api_send_input(pid, input);
}

export function getProcessOutput(pid: string): string {
  if (!_kernelReady) return '';
  try {
    return rust.api_get_output(pid);
  } catch {
    return '';
  }
}

// ============================================================
// Shell
// ============================================================

export function shellInput(input: string): string {
  if (!_kernelReady) return 'Kernel not ready\n';
  return rust.api_shell_input(input);
}

export function getShellPrompt(): string {
  if (!_kernelReady) return '# ';
  return rust.api_shell_get_prompt();
}

// ============================================================
// Filesystem
// ============================================================

export function listDir(path: string): any[] {
  if (!_kernelReady) return [];
  try {
    const result = rust.api_list_dir(path);
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export function readFile(path: string): Uint8Array | null {
  if (!_kernelReady) return null;
  try {
    return rust.api_read_file(path);
  } catch {
    return null;
  }
}

export function writeFile(path: string, content: string): boolean {
  if (!_kernelReady) return false;
  try {
    const data = new TextEncoder().encode(content);
    rust.api_write_file(path, data);
    return true;
  } catch (e) {
    console.error(`[KernelService] Failed to write file ${path}:`, e);
    return false;
  }
}

export function mount(path: string, source: string, fsType: string): void {
  assertReady();
  rust.api_mount(path, source, fsType);
}

export function unmount(path: string): void {
  assertReady();
  rust.api_unmount(path);
}

export function resolvePath(path: string): string {
  assertReady();
  return rust.api_resolve_path(path);
}

export function vfsStats(): VfsStats | null {
  if (!_kernelReady) return null;
  try {
    const result = rust.api_vfs_stats();
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// ============================================================
// VFS Export/Import
// ============================================================

export function exportVFS(): string | null {
  if (!_kernelReady) return null;
  try {
    return rust.kernel_export_vfs();
  } catch {
    return null;
  }
}

export async function saveVFSState(): Promise<void> {
  const vfsJson = exportVFS();
  if (vfsJson) {
    await saveVFS(vfsJson);
  }
}

// ============================================================
// Trymon Apps
// ============================================================

export function installTrymonApp(binaryId: string): BinaryInfo | null {
  if (!_kernelReady) return null;
  try {
    const result = rust.kernel_trymon_install(binaryId);
    return JSON.parse(result);
  } catch {
    return null;
  }
}

export function listTrymonApps(): any[] {
  if (!_kernelReady) return [];
  try {
    const result = rust.kernel_trymon_list_apps();
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export function runTrymonApp(appId: string): any | null {
  if (!_kernelReady) return null;
  try {
    const result = rust.kernel_trymon_run_app(appId);
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// ============================================================
// Internal Helpers
// ============================================================

function assertReady(): void {
  if (!_kernelReady) {
    throw new Error('Kernel not initialized');
  }
}

function _startTickLoop(): void {
  _tickInterval = setInterval(() => {
    if (_kernelReady) {
      try {
        rust.api_tick();
        _kernelState = getState();
      } catch (e) {
        console.error('[KernelService] Tick error:', e);
      }
    }
  }, 1000);
}

function _startAutoSave(): void {
  // Auto-save VFS every 30 seconds
  _autoSaveInterval = setInterval(() => {
    if (_kernelReady) {
      saveVFSState();
    }
  }, 30000);
}

/**
 * Cleanup — stops tick and auto-save intervals
 * Call this when unmounting the app
 */
export function cleanup(): void {
  if (_tickInterval) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
  if (_autoSaveInterval) {
    clearInterval(_autoSaveInterval);
    _autoSaveInterval = null;
  }
}

// ============================================================
// Direct rust export for advanced usage
// ============================================================

// ============================================================
// Virtual Web Seeding
// ============================================================

function seedVirtualWeb() {
  console.log('[KernelService] Seeding Virtual Web Content...');

  // Create /www structure
  rust.api_shell_input('mkdir -p /www/store /www/social /www/cloud');

  // Trymon Store
  writeFile('/www/store/index.json', JSON.stringify({
    title: 'Trymon App Store',
    hero: 'O marketplace oficial dos melhores binários para o seu sistema.',
    theme: '#00f2ff',
    sections: [
      {
        title: 'Principais Aplicativos',
        items: [
          { id: 'binary_1', name: 'Code Editor Pro', desc: 'Editor de código focado em performance.', icon: 'FileCode', action: 'Install' },
          { id: 'binary_2', name: 'Video Station', desc: 'Player de mídia universal para o Trymon.', icon: 'Image', action: 'Install' }
        ]
      },
      {
        title: 'Utilidades',
        items: [
          { id: 'util_1', name: 'Network Monitor', desc: 'Acompanhe o tráfego em tempo real.', icon: 'Activity', action: 'Run' },
          { id: 'util_2', name: 'Disk Cleaner', desc: 'Otimize seu VFS com um clique.', icon: 'Trash2', action: 'Run' }
        ]
      }
    ]
  }));

  // Trymon Social
  writeFile('/www/social/index.json', JSON.stringify({
    title: 'Trymon Connect',
    hero: 'Onde todos os processos se encontram.',
    theme: '#7ee787',
    sections: [
      {
        title: 'Novidades do Kernel',
        items: [
          { id: 'post_1', name: 'Kernel v4.5 lançado!', desc: 'Melhorias de 20% no VFS e novos drivers.', icon: 'Cpu' },
          { id: 'post_2', name: 'Novas atualizações de segurança', desc: 'Estamos protegendo seu ambiente WASM.', icon: 'ShieldCheck' }
        ]
      }
    ]
  }));

  // Trymon Cloud
  writeFile('/www/cloud/index.json', JSON.stringify({
    title: 'Trymon Cloud Drive',
    hero: 'Seus arquivos, em qualquer terminal.',
    theme: '#ffa657',
    sections: [
      {
        title: 'Arquivos Recentes',
        items: [
          { id: 'cloud_1', name: 'backup_system.trymon', desc: 'Salvo há 2 horas.', icon: 'Package' },
          { id: 'cloud_2', name: 'resume.pdf', desc: 'Salvo com sucesso.', icon: 'FileText' }
        ]
      }
    ]
  }));
}

// Trymord Persistence
export function saveTrymordMessage(message: any) {
  if (!_kernelReady) return;
  const history = getTrymordHistory();
  history.push(message);
  writeFile('/var/log/trymord/history.json', JSON.stringify(history));
}

export function getTrymordHistory(): any[] {
  if (!_kernelReady) return [];
  const content = readFile('/var/log/trymord/history.json');
  if (!content) return [];
  try {
    return JSON.parse(new TextDecoder().decode(content));
  } catch {
    return [];
  }
}

function initTrymordBackend() {
  console.log('[KernelService] Initializing Trymord Backend...');
  rust.api_shell_input('mkdir -p /var/log/trymord');
  if (!readFile('/var/log/trymord/history.json')) {
    const initialHistory = [
      { user: 'Trymon AI', avatar: 'AI', text: 'Bem-vindo ao servidor oficial Trymon Kernel! Sinta-se em casa.', time: '10:30' },
      { user: 'Root', avatar: 'R', text: 'Alguém testou o novo carregador de binários?', time: '11:05' }
    ];
    writeFile('/var/log/trymord/history.json', JSON.stringify(initialHistory));
  }
}

// ============================================================
// TVM Functions
// ============================================================

export interface TvmExecutionResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  error?: string;
  stats?: {
    instructions_executed: number;
    function_calls: number;
    syscall_count: number;
    allocations: number;
    cycles: number;
  };
}

export interface TvmPackageInfo {
  packageId: string;
  name: string;
  format: string;
  size: number;
}

export function getTVMSandboxStatus(): any | null {
  if (!_kernelReady) return null;
  try {
    const result = rust.tvm_sandbox_status();
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/**
 * Compile an ELF or wrap a binary into TVM bytecode.
 * Returns the TVM package ID to use with executeTvmPackage / installTvmPackage.
 */
export async function compileBinaryToTrymon(
  file: File
): Promise<{ packageId: string; format: string; originalSize: number }> {
  assertReady();

  console.log(`[KernelService] Starting compilation: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);

  const data = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.[^.]+$/, ''); // strip extension

  // Detect format
  const isELF = data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46;
  const isTrymon = data[0] === 0x54 && data[1] === 0x52 && data[2] === 0x59 && data[3] === 0x4d;
  const hasSquashFS = data.length > 4 && (() => {
    for (let i = 0; i < Math.min(data.length - 4, 10000); i++) {
      if (data[i] === 0x68 && data[i + 1] === 0x73 && data[i + 2] === 0x71 && data[i + 3] === 0x73) {
        return true;
      }
    }
    return false;
  })();

  console.log(`[KernelService] Format detection: ELF=${isELF}, Trymon=${isTrymon}, HasSquashFS=${hasSquashFS}`);

  let packageId: string;
  let format: string;

  if (isTrymon) {
    // Already .trymon — load directly
    console.log(`[KernelService] Loading .trymon package directly`);
    try {
      packageId = rust.tvm_load(data);
      format = 'Trymon';
      console.log(`[KernelService] Successfully loaded: ${packageId}`);
    } catch (err: any) {
      console.error(`[KernelService] tvm_load failed:`, err);
      throw new Error(`Failed to load .trymon file: ${err.message || String(err)}`);
    }
  } else if (isELF) {
    // ELF binary — compile to TVM via WASM
    if (hasSquashFS) {
      console.warn(`[KernelService] AppImage detected (ELF + SquashFS) - compiling as ELF wrapper`);
    }

    console.log(`[KernelService] Compiling ELF to TVM...`);
    try {
      packageId = rust.tvm_compile_elf(data, name);
      format = 'ELF→Trymon';
      console.log(`[KernelService] Compilation successful: ${packageId}`);
    } catch (err: any) {
      console.error(`[KernelService] tvm_compile_elf failed:`, err);
      throw new Error(`ELF compilation failed: ${err.message || String(err)}`);
    }
  } else {
    // Unknown format — wrap as generic payload
    console.log(`[KernelService] Unknown format, wrapping as generic TVM package`);

    // Create a minimal TVM bytecode: HALT(0)
    const haltBytecode = new Uint8Array([
      // HALT opcode = 0x58, operand = 4 bytes (exit code 0)
      0x58, 0x00, 0x00, 0x00, 0x00
    ]);
    // Build a .trymon v2 container manually
    const metaStr = JSON.stringify({
      name,
      version: '1.0.0',
      entry: 'main',
      description: `Wrapped binary: ${file.name}`,
    });
    const metaBytes = new TextEncoder().encode(metaStr);
    const pkg = new Uint8Array(4 + 1 + 4 + metaBytes.length + 4 + haltBytecode.length);
    let off = 0;
    // Magic "TRYM"
    pkg[off++] = 0x54; pkg[off++] = 0x52; pkg[off++] = 0x59; pkg[off++] = 0x4d;
    // Version 2
    pkg[off++] = 2;
    // Meta length (LE32)
    const ml = metaBytes.length;
    pkg[off++] = ml & 0xff; pkg[off++] = (ml >> 8) & 0xff;
    pkg[off++] = (ml >> 16) & 0xff; pkg[off++] = (ml >> 24) & 0xff;
    // Meta bytes
    pkg.set(metaBytes, off); off += ml;
    // Code length (LE32)
    const cl = haltBytecode.length;
    pkg[off++] = cl & 0xff; pkg[off++] = (cl >> 8) & 0xff;
    pkg[off++] = (cl >> 16) & 0xff; pkg[off++] = (cl >> 24) & 0xff;
    // Code bytes
    pkg.set(haltBytecode, off);

    try {
      packageId = rust.tvm_load(pkg);
      format = 'Unknown→Trymon';
      console.log(`[KernelService] Generic package loaded: ${packageId}`);
    } catch (err: any) {
      console.error(`[KernelService] tvm_load (generic) failed:`, err);
      throw new Error(`Failed to load wrapped package: ${err.message || String(err)}`);
    }
  }

  console.log(`[KernelService] Compilation complete: ${format} -> ${packageId}`);
  return { packageId, format, originalSize: data.length };
}

/**
 * Execute a loaded TVM package by ID.
 */
export function executeTvmPackage(packageId: string): TvmExecutionResult {
  assertReady();
  try {
    const json = rust.tvm_execute(packageId);
    return JSON.parse(json) as TvmExecutionResult;
  } catch (e: any) {
    return {
      success: false,
      exit_code: -1,
      stdout: '',
      stderr: '',
      error: String(e),
    };
  }
}

/**
 * Install a loaded TVM package to the VFS.
 * Returns the AppInfo JSON.
 */
export function installTvmPackage(packageId: string, name: string): any | null {
  if (!_kernelReady) return null;
  try {
    const result = rust.trymon_install_tvm(packageId, name);
    return JSON.parse(result);
  } catch (e) {
    console.error('[KernelService] installTvmPackage failed:', e);
    return null;
  }
}

/**
 * Export a compiled TVM package as .trymon binary data and trigger download.
 */
export function downloadTvmPackage(packageId: string, fileName: string): boolean {
  if (!_kernelReady) return false;
  try {
    const data = rust.tvm_export_package(packageId) as Uint8Array;
    // Create a copy as plain array to avoid SharedArrayBuffer issues
    const plainArray = Array.from(data);
    const blob = new Blob([new Uint8Array(plainArray)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.trymon') ? fileName : `${fileName}.trymon`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (e) {
    console.error('[KernelService] downloadTvmPackage failed:', e);
    return false;
  }
}

// ============================================================
// v86 Emulator API for Real Linux Execution
// ============================================================

/**
 * Initialize the v86 emulator for real Linux execution
 */
export async function initV86(screenElement?: HTMLCanvasElement): Promise<boolean> {
  if (_v86Ready) return true;

  console.log('[KernelService] Initializing v86 emulator for real Linux execution...');

  try {
    _v86Emulator = new V86Emulator({
      memorySize: 256,
      videoMemorySize: 8,
    });

    // Disable shell mode for real Linux boot
    if (_v86Emulator) {
      (_v86Emulator as any).state.shellMode = false;
    }

    const result = await _v86Emulator.initialize(screenElement);
    _v86Ready = result;

    if (result) {
      console.log('[KernelService] v86 emulator initialized successfully');
      // Start the emulator
      _v86Emulator.start();
    } else {
      console.error('[KernelService] v86 emulator initialization failed');
    }

    return result;
  } catch (e) {
    console.error('[KernelService] v86 initialization failed:', e);
    return false;
  }
}

/**
 * Execute an AppImage via v86 with real Linux emulation
 */
export async function executeAppImageViaV86(
  binaryId: string,
  fileName: string,
  fileData: Uint8Array,
  options?: {
    extractAndRun?: boolean;
    timeout?: number;
    args?: string[];
  }
): Promise<V86ExecutionResult | null> {
  if (!_v86Ready || !_v86Emulator) {
    console.error('[KernelService] v86 not ready for AppImage execution');
    return {
      success: false,
      output: 'v86 emulator not initialized',
      exitCode: -1,
      duration: 0
    };
  }

  console.log(`[KernelService] Executing AppImage via v86: ${fileName}`);

  // Create BinaryFile object
  const binaryFile: BinaryFile = {
    id: binaryId,
    name: fileName,
    size: fileData.length,
    type: 'appimage',
    data: fileData.buffer as ArrayBuffer,
    uploadedAt: new Date(),
    status: 'pending'
  };

  try {
    // Mount the binary first
    const mounted = await _v86Emulator.mountBinary(binaryFile);
    if (!mounted) {
      return {
        success: false,
        output: 'Failed to mount AppImage',
        exitCode: -1,
        duration: 0
      };
    }

    // Execute via v86
    const result = await _v86Emulator.executeAppImage(binaryFile, {
      extractAndRun: options?.extractAndRun ?? true,
      timeout: options?.timeout ?? 120000,
      args: options?.args ?? []
    });

    console.log(`[KernelService] v86 execution result:`, result);
    return result;
  } catch (e) {
    console.error('[KernelService] v86 AppImage execution failed:', e);
    return {
      success: false,
      output: `Execution error: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: -1,
      duration: 0
    };
  }
}

/**
 * Send input to v86 emulator (for interactive apps)
 */
export function sendV86Input(input: string): void {
  if (_v86Emulator && _v86Ready) {
    _v86Emulator.sendInput(input);
  }
}

/**
 * Get v86 emulator state
 */
export function getV86State(): any {
  return _v86Emulator ? (_v86Emulator as any).state : null;
}

export { rust };
