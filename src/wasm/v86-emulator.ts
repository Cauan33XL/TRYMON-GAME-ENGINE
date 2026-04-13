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

  async initialize(screenElement?: HTMLCanvasElement): Promise<boolean> {
    try {
      await this.loadV86Library();

      const V86Class = (window as any).V86;
      if (!V86Class) {
        throw new Error('v86 library not loaded');
      }

      const bootModules = await this.loadBootModules();

      this.emulator = new V86Class({
        wasm_path: this.config.wasmPath,
        memory_size: this.config.memorySize! * 1024 * 1024,
        vga_memory_size: this.config.videoMemorySize! * 1024 * 1024,
        screen_container: screenElement,
        bios: { url: this.config.biosUrl || '/v86/bios/seabios.bin' },
        vga_bios: { url: this.config.vgaBiosUrl || '/v86/bios/vgabios.bin' },
        hda: { url: this.config.hdaUrl },
        cdrom: { url: this.config.cdromUrl },
        autostart: this.config.autostart,
        net_device: { relay_url: '' },
        log_level: this.config.logLevel,
        
        bzimage: bootModules.kernel ? { url: bootModules.kernel } : undefined,
        initrd: bootModules.initrd ? { url: bootModules.initrd } : undefined,
        
        disable_keyboard: false,
        disable_mouse: false,
        
        filesystem: {
          baseurl: '/v86/fs',
          readurl: (path: string) => this.handleFileRead(path),
          listdir: (path: string) => this.handleDirList(path)
        },
        
        on_stdout: (data: string) => this.handleStdout(data),
        on_stderr: (data: string) => this.handleStderr(data),
        on_serial0_byte: (byte: number) => this.handleSerialByte(byte),
        on_serial0_line: (line: string) => this.handleSerialLine(line),
        
        on_boot: () => this.handleBoot(),
        onCrashed: (reg: any) => this.handleCrash(reg),
      });

      // Initialize Rust Kernel
      await rust.default('/wasm/pkg/trymon_kernel_rust_bg.wasm');
      rust.api_kernel_init('{}');
      
      const prompt = rust.api_shell_get_prompt();
      this.handleStdout(prompt);

      this.state.isReady = true;
      this.notifyStateChange();
      
      return true;
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Failed to initialize emulator';
      this.notifyStateChange();
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
      let url: string;

      if (file.path) {
        url = `http://localhost:3001${file.path}`;
      } else if (file.data) {
        const blob = new Blob([file.data], { type: 'application/octet-stream' });
        url = URL.createObjectURL(blob);
      } else {
        throw new Error('No data or path provided for binary');
      }
      
      const mountPath = `/tmp/${file.name}`;
      this.mountedBinaries.set(mountPath, file);
      
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
      timeout?: number;
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

  private async loadBootModules(): Promise<{ kernel?: string; initrd?: string }> {
    const modules: { kernel?: string; initrd?: string } = {};
    
    try {
      if (this.config.kernelUrl) {
        modules.kernel = this.config.kernelUrl;
      }
      if (this.config.initrdUrl) {
        modules.initrd = this.config.initrdUrl;
      }
    } catch (error) {
      console.warn('Failed to load boot modules:', error);
    }
    
    return modules;
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