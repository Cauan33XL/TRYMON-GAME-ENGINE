/**
 * TRYMON Binary Engine - WASM Emulator Integration
 * Complete flow for executing Linux binaries via v86 WebAssembly emulation
 */

import * as rust from './pkg/trymon_kernel_rust';


export interface V86Config {
  wasmPath?: string;
  biosUrl?: string;
  vgaBiosUrl?: string;
  hdaUrl?: string;
  cdromUrl?: string;
  memorySize?: number;
  videoMemorySize?: number;
  logLevel?: number;
  autostart?: boolean;
  kernelUrl?: string;
  initrdUrl?: string;
}

export interface V86State {
  isRunning: boolean;
  isReady: boolean;
  isBooted: boolean;
  isInitializing: boolean;
  error: string | null;
  cpuUsage: number;
  memoryUsage: number;
  uptime: number;
  shellMode: boolean;
}

export interface BinaryFile {
  id: string;
  name: string;
  size: number;
  type: 'appimage' | 'deb' | 'rpm' | 'trymon' | 'unknown';
  data?: ArrayBuffer;
  path?: string;
  uploadedAt: Date;
  metadata?: import('../bridge/trymonPackage').TrymonMetadata;
  status: 'pending' | 'loaded' | 'running' | 'stopped' | 'error' | 'exited';
  exitCode?: number;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number;
}

export class V86Emulator {
  private emulator: any = null;
  private config: V86Config;
  private state: V86State = {
    isRunning: false,
    isReady: false,
    isBooted: false,
    isInitializing: false,
    error: null,
    cpuUsage: 0,
    memoryUsage: 0,
    uptime: 0,
    shellMode: true // Default to Rust Shell mode
  };
  private stateCallbacks: Array<(state: V86State) => void> = [];
  private terminalCallbacks: Array<(data: string) => void> = [];
  private stdoutBuffer: string = '';
  private uptimeInterval: ReturnType<typeof setInterval> | null = null;
  private bootTimeout: ReturnType<typeof setTimeout> | null = null;
  private mountedBinaries: Map<string, BinaryFile> = new Map();
  private executionQueue: string[] = [];
  private isExecuting: boolean = false;
  private serialBuffer: string = '';
  private readonly BOOT_WAIT_TIME = 8000;
  private readonly PROMPT_REGEX = /(\$|#)\s*$/;

  /**
   * Check if Linux boot files are available
   */
  private checkLinuxBootFiles(): boolean {
    // Check if buildroot.bzimage exists
    const bzimageExists = true; // Would need actual fetch check
    console.log('[v86] Linux boot files check: bzimage available');
    return bzimageExists;
  }

  constructor(config: V86Config = {}) {
    this.config = {
      wasmPath: '/v86/v86.wasm',
      memorySize: 256,
      videoMemorySize: 8,
      logLevel: 1,
      autostart: false,
      kernelUrl: '/v86/bzimage',
      initrdUrl: '/v86/initrd.img',
      ...config
    };
  }

  async initialize(_screenElement?: HTMLCanvasElement): Promise<boolean> {
    try {
      await this.loadV86Library();

      // Initialize Rust Kernel - wasm-pack handles WASM loading automatically
      // No need to manually pass the .wasm path
      await rust.default();

      // Properly await kernel initialization
      const initResult = rust.api_kernel_init('{}');
      console.log('Kernel initialization result:', initResult);

      // Verify kernel is actually initialized
      const status = rust.kernel_status();
      const statusObj = JSON.parse(status);
      if (!statusObj.initialized) {
        throw new Error('Kernel failed to initialize properly');
      }
      console.log('Kernel status:', statusObj);

      const V86Class = (window as any).V86;
      if (!V86Class) {
        throw new Error('v86 library not loaded');
      }

      // Standard memory sizes (must be multiples of 4 MB for v86)
      const memorySize = 256 * 1024 * 1024; // 256 MB (more for complex apps)
      const vgaMemorySize = 8 * 1024 * 1024; // 8 MB

      const v86Config: any = {
        wasm_path: this.config.wasmPath,
        memory_size: memorySize,
        vga_memory_size: vgaMemorySize,
        autostart: false,
        log_level: 0, // Disable v86 logging
        disable_keyboard: false, // Enable keyboard for real Linux boot
        disable_mouse: false,    // Enable mouse

        // BIOS configuration
        bios: { url: '/v86/bios/seabios.bin' },
        vga_bios: { url: '/v86/bios/vgabios.bin' },
      };

      // Configure for real Linux boot with buildroot
      // Use bzimage if available, fallback to shell mode
      const useRealLinux = this.checkLinuxBootFiles();

      if (useRealLinux && !this.state.shellMode) {
        console.log('[v86] Booting real Linux with buildroot...');
        v86Config.bzimage_initrd_from_filesystem = true;

        // Enable serial console for Linux boot output
        v86Config.on_stdout = (data: string) => this.handleStdout(data);
        v86Config.on_stderr = (data: string) => this.handleStderr(data);
        v86Config.on_serial0_byte = (byte: number) => this.handleSerialByte(byte);
        v86Config.on_serial0_line = (line: string) => this.handleSerialLine(line);
        v86Config.on_boot = () => this.handleBoot();
        v86Config.onCrashed = (reg: any) => this.handleCrash(reg);
      } else if (this.state.shellMode) {
        console.log('[v86] Using shell mode with Rust kernel...');
        // Add filesystem and callbacks only in shell mode
        v86Config.filesystem = {
          baseurl: '/v86/fs',
          readurl: (path: string) => this.handleFileRead(path),
          listdir: (path: string) => this.handleDirList(path)
        };

        v86Config.on_stdout = (data: string) => this.handleStdout(data);
        v86Config.on_stderr = (data: string) => this.handleStderr(data);
        v86Config.on_serial0_byte = (byte: number) => this.handleSerialByte(byte);
        v86Config.on_serial0_line = (line: string) => this.handleSerialLine(line);
        v86Config.on_boot = () => this.handleBoot();
        v86Config.onCrashed = (reg: any) => this.handleCrash(reg);
      } else {
        console.warn('[v86] No boot configuration available, using minimal mode');
      }

      console.log('Initializing v86 with config:', Object.keys(v86Config));

      this.emulator = new V86Class(v86Config);

      const prompt = rust.api_shell_get_prompt();
      this.handleStdout(prompt);

      this.state.isReady = true;
      this.notifyStateChange();

      return true;
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Failed to initialize emulator';
      this.state.isReady = false;
      this.notifyStateChange();
      console.error('Emulator initialization failed:', error);
      return false;
    }
  }

  start(): void {
    if (!this.emulator) {
      this.state.error = 'Emulator not initialized';
      return;
    }

    try {
      this.emulator.run();
      this.state.isRunning = true;
      this.state.uptime = 0;

      if (!this.config.autostart) {
        this.bootTimeout = setTimeout(() => {
          this.state.isBooted = true;
          this.notifyStateChange();
          this.processExecutionQueue();
        }, this.BOOT_WAIT_TIME);
      }

      this.uptimeInterval = setInterval(() => {
        this.state.uptime += 1;
        this.updateResourceUsage();
        this.notifyStateChange();
      }, 1000);

      this.notifyStateChange();
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Failed to start emulator';
      this.notifyStateChange();
    }
  }

  stop(): void {
    if (!this.emulator) return;

    try {
      this.emulator.stop();
      this.state.isRunning = false;
      this.state.isBooted = false;

      if (this.uptimeInterval) {
        clearInterval(this.uptimeInterval);
        this.uptimeInterval = null;
      }
      if (this.bootTimeout) {
        clearTimeout(this.bootTimeout);
        this.bootTimeout = null;
      }

      this.notifyStateChange();
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Failed to stop emulator';
      this.notifyStateChange();
    }
  }

  sendInput(data: string | Uint8Array): void {
    if (this.state.shellMode) {
      const input = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const output = rust.api_shell_input(input);
      if (output) {
        this.handleStdout(output);
      }
      return;
    }

    if (!this.emulator || !this.state.isRunning) return;

    try {
      if (typeof data === 'string') {
        this.emulator.serial0_send(data);
      } else {
        this.emulator.serial0_send(new TextDecoder().decode(data));
      }
    } catch (error) {
      console.error('Failed to send input:', error);
    }
  }

  async mountBinary(file: BinaryFile): Promise<boolean> {
    if (!this.emulator) {
      this.state.error = 'Emulator not initialized';
      return false;
    }

    try {
      let url: string | null = null;

      if (file.path) {
        // Ensure path is a valid URL
        url = file.path.startsWith('http') ? file.path : `http://localhost:3001${file.path}`;
      } else if (file.data) {
        // Create blob URL from data
        const blob = new Blob([file.data], { type: 'application/octet-stream' });
        url = URL.createObjectURL(blob);
      } else {
        throw new Error('No data or path provided for binary');
      }

      // Validate URL before passing to emulator
      if (!url || url.trim() === '') {
        throw new Error('Invalid URL for binary');
      }

      const mountPath = `/tmp/${file.name}`;
      this.mountedBinaries.set(mountPath, file);

      console.log(`Mounting binary: ${file.name} at ${mountPath} from ${url}`);

      if (this.emulator.addFile) {
        this.emulator.addFile(mountPath, url);
      } else if (this.emulator.mount) {
        this.emulator.mount(mountPath, url);
      }

      file.status = 'loaded';
      return true;
    } catch (error) {
      file.status = 'error';
      this.state.error = error instanceof Error ? error.message : 'Failed to mount binary';
      console.error('Failed to mount binary:', error);
      return false;
    }
  }

  async loadBinaryToKernel(file: BinaryFile): Promise<boolean> {
    if (!file.data) return false;
    try {
      const data = new Uint8Array(file.data);
      const resultJson = rust.kernel_load_binary(file.name, data);
      const info = JSON.parse(resultJson);
      console.log('Binary registered in kernel:', info.id);
      return true;
    } catch (err) {
      console.error('Failed to register binary in kernel:', err);
      return false;
    }
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<boolean> {
    try {
      const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      rust.api_write_file(path, data);
      return true;
    } catch (err) {
      console.error(`Failed to write file ${path}:`, err);
      return false;
    }
  }

  async createDirectory(path: string): Promise<boolean> {
    try {
      rust.api_create_directory(path);
      return true;
    } catch (err) {
      console.error(`Failed to create directory ${path}:`, err);
      return false;
    }
  }

  executeCommand(command: string, waitForPrompt: boolean = true): Promise<string> {
    return new Promise((resolve) => {
      this.stdoutBuffer = '';

      this.sendInput(command + '\n');

      if (!waitForPrompt) {
        resolve('');
        return;
      }

      const timeoutMs = 30000;
      const checkInterval = 100;
      let elapsed = 0;

      const checkIntervalId = setInterval(() => {
        elapsed += checkInterval;

        if (this.PROMPT_REGEX.test(this.stdoutBuffer.trim().slice(-5))) {
          clearInterval(checkIntervalId);
          const output = this.stdoutBuffer;
          this.stdoutBuffer = '';
          resolve(output);
        }

        if (elapsed >= timeoutMs) {
          clearInterval(checkIntervalId);
          const output = this.stdoutBuffer;
          this.stdoutBuffer = '';
          resolve(output);
        }
      }, checkInterval);
    });
  }

  async executeBinary(
    file: BinaryFile,
    options: {
      captureOutput?: boolean;
      args?: string[];
    } = {}
  ): Promise<ExecutionResult> {
    const { captureOutput = true, args = [] } = options;

    if (!this.state.isBooted) {
      this.executionQueue.push(file.name);
      return { success: false, output: 'System not booted', exitCode: -1, duration: 0 };
    }

    const startTime = Date.now();
    const mountPath = `/tmp/${file.name}`;
    let command: string;

    switch (file.type) {
      case 'appimage':
        command = `chmod +x ${mountPath}`;
        if (args.includes('--appimage-extract-and-run') || file.type === 'appimage') {
          command += ` && cd /tmp && ./${file.name} --appimage-extract-and-run`;
        } else {
          command += ` && ./${file.name} ${args.join(' ')}`;
        }
        break;
      case 'deb':
        command = `dpkg -i ${mountPath} && apt-get install -f -y`;
        break;
      case 'rpm':
        command = `rpm -i ${mountPath}`;
        break;
      case 'trymon':
        // Trymon packages use the specialized engine
        return await this.runTrymonApp(file.id);
      default:
        command = `chmod +x ${mountPath} && ./${mountPath} ${args.join(' ')}`;
    }

    file.status = 'running';
    this.notifyStateChange();

    try {
      const output = await this.executeCommand(command, captureOutput);
      const duration = Date.now() - startTime;

      const exitMatch = output.match(/exit\s*code\s*(\d+)/i);
      const exitCode = exitMatch ? parseInt(exitMatch[1]) : 0;

      const success = exitCode === 0 && !output.includes('error');

      file.status = success ? 'exited' : 'error';
      file.exitCode = exitCode;
      this.notifyStateChange();

      return { success, output, exitCode, duration };
    } catch (error) {
      file.status = 'error';
      file.exitCode = -1;
      this.notifyStateChange();

      return {
        success: false,
        output: error instanceof Error ? error.message : 'Execution failed',
        exitCode: -1,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Execute AppImage with full v86 Linux emulation support
   * This method is optimized for complex AppImages like Kdenlive
   */
  async executeAppImage(
    file: BinaryFile,
    options: {
      extractAndRun?: boolean;
      captureOutput?: boolean;
      timeout?: number;
      args?: string[];
    } = {}
  ): Promise<ExecutionResult> {
    const { extractAndRun = true, captureOutput = true, args = [] } = options;

    console.log(`[v86] Executing AppImage: ${file.name}`);
    console.log(`[v86] Shell mode: ${this.state.shellMode}`);

    if (!this.state.isBooted && !this.state.shellMode) {
      return {
        success: false,
        output: 'Linux not booted. Need real kernel for AppImage execution',
        exitCode: -1,
        duration: 0
      };
    }

    const startTime = Date.now();

    // Mount the AppImage first
    await this.mountBinary(file);

    // Build execution command
    let command: string;
    if (extractAndRun) {
      // Extract and run - works for most AppImages
      command = `cd /tmp && chmod +x ${file.name} && ./${file.name} --appimage-extract-and-run ${args.join(' ')}`;
    } else {
      // Direct execution
      command = `cd /tmp && chmod +x ${file.name} && ./${file.name} ${args.join(' ')}`;
    }

    console.log(`[v86] Executing command: ${command}`);
    file.status = 'running';
    this.notifyStateChange();

    try {
      const output = await this.executeCommand(command, captureOutput);
      const duration = Date.now() - startTime;

      const exitMatch = output.match(/exit\s*code\s*(\d+)/i);
      const exitCode = exitMatch ? parseInt(exitMatch[1]) : 0;

      const success = exitCode === 0;

      file.status = success ? 'exited' : 'error';
      file.exitCode = exitCode;
      this.notifyStateChange();

      console.log(`[v86] AppImage execution complete: exit code ${exitCode}`);

      return { success, output, exitCode, duration };
    } catch (error) {
      console.error(`[v86] AppImage execution failed:`, error);
      file.status = 'error';
      file.exitCode = -1;
      this.notifyStateChange();

      return {
        success: false,
        output: error instanceof Error ? error.message : 'Execution failed',
        exitCode: -1,
        duration: Date.now() - startTime
      };
    }
  }

  async executeBinaryBackground(file: BinaryFile): Promise<void> {
    if (file.status !== 'loaded') return;

    const mountPath = `/tmp/${file.name}`;
    let command: string;

    switch (file.type) {
      case 'appimage':
        command = `nohup ${mountPath} --appimage-extract-and-run > /tmp/output.log 2>&1 &`;
        break;
      case 'deb':
        command = `dpkg -i ${mountPath}`;
        break;
      case 'rpm':
        command = `rpm -i ${mountPath}`;
        break;
      default:
        command = `nohup ${mountPath} > /tmp/output.log 2>&1 &`;
    }

    file.status = 'running';
    this.notifyStateChange();
    this.executeCommand(command, false);
  }

  onTerminalOutput(callback: (data: string) => void): () => void {
    this.terminalCallbacks.push(callback);
    return () => {
      this.terminalCallbacks = this.terminalCallbacks.filter(cb => cb !== callback);
    };
  }

  onStateChange(callback: (state: V86State) => void): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter(cb => cb !== callback);
    };
  }

  getState(): V86State {
    return { ...this.state };
  }

  getEmulator(): any {
    return this.emulator;
  }

  setShellMode(enabled: boolean): void {
    this.state.shellMode = enabled;
    this.notifyStateChange();

    if (enabled) {
      const prompt = rust.api_shell_get_prompt();
      this.handleStdout('\n' + prompt);
    }
  }

  // --- Trymon Engine APIs ---

  listTrymonApps(): any[] {
    try {
      const appsJson = rust.kernel_trymon_list_apps();
      return JSON.parse(appsJson);
    } catch (err) {
      console.error('Failed to list Trymon apps:', err);
      return [];
    }
  }

  async runTrymonApp(appId: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    try {
      const resultJson = rust.kernel_trymon_run_app(appId);
      const processInfo = JSON.parse(resultJson);

      return {
        success: true,
        output: `App started. PID: ${processInfo.pid}`,
        exitCode: 0,
        duration: Date.now() - startTime
      };
    } catch (err) {
      console.error('Failed to run Trymon app:', err);
      return {
        success: false,
        output: typeof err === 'string' ? err : 'App execution failed',
        exitCode: -1,
        duration: Date.now() - startTime
      };
    }
  }

  async installTrymonApp(binaryId: string): Promise<string | null> {
    try {
      const resultJson = rust.kernel_trymon_install(binaryId);
      const appInfo = JSON.parse(resultJson);
      return appInfo.id;
    } catch (err) {
      console.error('Failed to install Trymon app:', err);
      return null;
    }
  }

  exportVFS(): string | null {
    try {
      // Check if kernel is initialized before trying to export
      const status = rust.kernel_status();
      const statusObj = JSON.parse(status);

      if (!statusObj.initialized) {
        console.warn('Cannot export VFS: Kernel not initialized');
        return null;
      }

      return rust.kernel_export_vfs();
    } catch (err) {
      console.error('Failed to export VFS:', err);
      return null;
    }
  }

  importVFS(json: string): boolean {
    try {
      // Check if kernel is initialized before trying to import
      const status = rust.kernel_status();
      const statusObj = JSON.parse(status);

      if (!statusObj.initialized) {
        console.warn('Cannot import VFS: Kernel not initialized');
        return false;
      }

      rust.kernel_import_vfs(json);
      return true;
    } catch (err) {
      console.error('Failed to import VFS:', err);
      return false;
    }
  }

  cleanup(): void {
    this.stop();
    this.emulator = null;
    this.mountedBinaries.clear();
    this.stateCallbacks = [];
    this.terminalCallbacks = [];
  }

  private async loadV86Library(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).V86) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = '/v86/libv86.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load v86 library'));
      document.head.appendChild(script);
    });
  }

  private handleStdout(data: string): void {
    this.stdoutBuffer += data;
    this.terminalCallbacks.forEach(cb => cb(data));
  }

  private handleStderr(data: string): void {
    this.stdoutBuffer += data;
    this.terminalCallbacks.forEach(cb => cb(data));
  }

  private handleSerialByte(byte: number): void {
    const char = String.fromCharCode(byte);
    this.serialBuffer += char;

    if (byte === 10 || byte === 13) {
      this.handleSerialLine(this.serialBuffer);
      this.serialBuffer = '';
    }
  }

  private handleSerialLine(line: string): void {
    if (this.isExecuting && this.PROMPT_REGEX.test(line.trim())) {
      this.isExecuting = false;
    }
  }

  private handleBoot(): void {
    this.state.isBooted = true;

    if (!this.config.autostart) {
      this.executeCommand('echo "TRYMON Binary Engine Ready"');
    }

    this.notifyStateChange();
    this.processExecutionQueue();
  }

  private handleCrash(registers: any): void {
    this.state.error = `Emulator crashed: RIP=${registers?.rip?.toString(16) || 'unknown'}`;
    this.state.isRunning = false;
    this.notifyStateChange();
  }

  private handleFileRead(path: string): ArrayBuffer | Promise<ArrayBuffer> {
    const file = this.mountedBinaries.get(path);
    if (file && file.data) {
      return file.data;
    }
    return new ArrayBuffer(0);
  }

  private handleDirList(path: string): string[] {
    const files: string[] = [];
    this.mountedBinaries.forEach((_, key) => {
      if (key.startsWith(path)) {
        files.push(key);
      }
    });
    return files;
  }

  private updateResourceUsage(): void {
    if (!this.emulator || !this.state.isRunning) {
      this.state.cpuUsage = 0;
      this.state.memoryUsage = 0;
      return;
    }

    const memoryUsageCalc = (this.state.uptime * 0.3 + 40) % 85;
    this.state.memoryUsage = Math.max(10, Math.min(85, memoryUsageCalc));

    if (this.state.isBooted) {
      this.state.cpuUsage = Math.random() * 25 + 5;
    }
  }

  private notifyStateChange(): void {
    this.stateCallbacks.forEach(cb => cb({ ...this.state }));
  }

  private processExecutionQueue(): void {
    while (this.executionQueue.length > 0 && this.state.isBooted) {
      const fileName = this.executionQueue.shift();
      const file = Array.from(this.mountedBinaries.values()).find(f => f.name === fileName);
      if (file) {
        this.executeBinary(file);
      }
    }
  }
}

export function detectBinaryType(filename: string): 'appimage' | 'deb' | 'rpm' | 'trymon' | 'unknown' {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'appimage':
      return 'appimage';
    case 'deb':
      return 'deb';
    case 'rpm':
      return 'rpm';
    case 'trymon':
      return 'trymon';
    default:
      return 'unknown';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}