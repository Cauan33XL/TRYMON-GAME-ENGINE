/**
 * useKernelState Hook
 * 
 * Subscribes React components to kernel state updates.
 * The kernel is the single source of truth — this hook provides
 * reactive access to binaries, processes, and VFS state.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as kernel from '../services/kernelService';
import type { KernelState, BinaryInfo } from '../services/kernelService';

// ============================================================
// Main hook — full kernel state subscription
// ============================================================

export function useKernelState() {
  const [state, setState] = useState<KernelState>(kernel.getState());
  const [ready, setReady] = useState(kernel.isReady());

  useEffect(() => {
    // Subscribe to all kernel updates (including during boot)
    const unsubscribe = kernel.onUpdate((s) => {
      setState(s);
      if (s.state === 'Running') {
        setReady(true);
      }
    });

    // Poll for updates (kernel tick loop runs every 1s)
    const pollInterval = setInterval(() => {
      // Only overwrite if kernel is ready, otherwise let init() management take priority
      if (kernel.isReady()) {
        setState(kernel.getState());
      }
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
    };
  }, []);


  return useMemo(() => ({
    ready,
    state,
    initialized: state.initialized,
    uptime: state.uptime,
    binaries: state.loaded_binaries,
    processes: state.running_processes,
    memoryUsage: state.memory_usage_bytes,
    vfsStats: state.filesystem_stats,
    tvm_error: state.tvm_error,
    tvm_ready: state.tvm_ready,
  }), [ready, state]);
}

// ============================================================
// Binary-specific hooks
// ============================================================

export function useKernelBinaries() {
  const { ready, binaries } = useKernelState();

  const loadBinary = useCallback(async (file: File): Promise<BinaryInfo> => {
    const data = new Uint8Array(await file.arrayBuffer());
    return kernel.loadBinary(file.name, data);
  }, []);

  const removeBinary = useCallback((binaryId: string) => {
    kernel.removeBinary(binaryId);
  }, []);

  const executeBinary = useCallback((binaryId: string, args: string = '') => {
    return kernel.executeBinary(binaryId, args);
  }, []);

  return useMemo(() => ({
    ready,
    binaries,
    loadBinary,
    removeBinary,
    executeBinary,
  }), [ready, binaries, loadBinary, removeBinary, executeBinary]);
}

export function useBinaryById(binaryId: string | undefined) {
  const { binaries } = useKernelState();
  return binaries.find(b => b.id === binaryId) || null;
}

// ============================================================
// Process hooks
// ============================================================

export function useKernelProcesses() {
  const { ready, processes } = useKernelState();

  const stopProcess = useCallback((pid: string) => {
    kernel.stopProcess(pid);
  }, []);

  const killProcess = useCallback((pid: string) => {
    kernel.killProcess(pid);
  }, []);

  const sendInput = useCallback((pid: string, input: string) => {
    kernel.sendInput(pid, input);
  }, []);

  const getOutput = useCallback((pid: string) => {
    return kernel.getProcessOutput(pid);
  }, []);

  return useMemo(() => ({
    ready,
    processes,
    stopProcess,
    killProcess,
    sendInput,
    getOutput,
  }), [ready, processes, stopProcess, killProcess, sendInput, getOutput]);
}

export function useProcessById(pid: string | undefined) {
  const { processes } = useKernelState();
  const process = processes.find(p => p.pid === pid) || null;

  const output = process ? kernel.getProcessOutput(pid!) : '';
  const stop = useCallback(() => { pid && kernel.stopProcess(pid); }, [pid]);
  const kill = useCallback(() => { pid && kernel.killProcess(pid); }, [pid]);
  const sendInput = useCallback((input: string) => { pid && kernel.sendInput(pid!, input); }, [pid]);

  return useMemo(() => ({
    process,
    output,
    stop,
    kill,
    sendInput,
  }), [process, output, stop, kill, sendInput]);
}

// ============================================================
// Shell hooks
// ============================================================

export function useKernelShell() {
  const { ready } = useKernelState();
  const [output, setOutput] = useState('');

  const sendInput = useCallback((input: string) => {
    const result = kernel.shellInput(input);
    setOutput(prev => prev + result);
  }, []);

  const clear = useCallback(() => setOutput(''), []);

  const prompt = useMemo(() => kernel.getShellPrompt(), []);

  return useMemo(() => ({
    ready,
    output,
    prompt,
    sendInput,
    clear,
  }), [ready, output, prompt, sendInput, clear]);
}

// ============================================================
// Trymon Apps hooks
// ============================================================

export function useTrymonApps() {
  const { ready } = useKernelState();

  const apps = useMemo(() => kernel.listTrymonApps(), [ready]);

  const installApp = useCallback((binaryId: string) => {
    return kernel.installTrymonApp(binaryId);
  }, []);

  const runApp = useCallback((appId: string) => {
    return kernel.runTrymonApp(appId);
  }, []);

  return useMemo(() => ({
    ready,
    apps,
    installApp,
    runApp,
  }), [ready, apps, installApp, runApp]);
}

// ============================================================
// VFS hooks
// ============================================================

export function useVFS() {
  const { vfsStats } = useKernelState();

  const saveState = useCallback(() => {
    return kernel.saveVFSState();
  }, []);

  return useMemo(() => ({
    stats: vfsStats,
    saveState,
  }), [vfsStats, saveState]);
}

// ============================================================
// TVM hooks
// ============================================================

export function getTVMSandboxStatus() {
  return kernel.getTVMSandboxStatus();
}
