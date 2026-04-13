/**
 * Shell WASM Integration Hook
 * Uses the Rust-compiled shell module for bash-like functionality
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface ShellWasmState {
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
}

declare global {
  interface Window {
    trymon_kernel_rust: any;
  }
}


export function useShellWasm() {
  const [state, setState] = useState<ShellWasmState>({
    isReady: false,
    isLoading: true,
    error: null
  });

  const wasmLoaded = useRef(false);
  const kernelRef = useRef<any>(null);
  const outputRef = useRef<string>('TRYMON Shell v1.0.0\nType "help" for available commands.\n\n$ ');

  const initialize = useCallback(async () => {
    if (wasmLoaded.current || kernelRef.current) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Load WASM using the Vite-configured alias
      // This allows Vite to properly bundle and process the module
      const wasmModule = await import('@wasm/pkg/trymon_kernel_rust.js');
      
      // Initialize the WASM module if it has a default export (initializer)
      if (typeof wasmModule.default === 'function') {
        await wasmModule.default();
      }
      
      kernelRef.current = wasmModule;
      wasmLoaded.current = true;
      setState(prev => ({ ...prev, isReady: true, isLoading: false }));
    } catch (error) {
      console.error('Shell WASM Initialization Error:', error);
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: error instanceof Error ? error.message : 'Failed to initialize shell' 
      }));
    }
  }, []);


  useEffect(() => {
    initialize();
  }, [initialize]);

  const execute = useCallback(async (command: string): Promise<string> => {
    if (!kernelRef.current) {
      return 'Shell not ready, using fallback mode...\n';
    }

    try {
      if (kernelRef.current.api_shell_input) {
        const result = kernelRef.current.api_shell_input(command);
        return result || '';
      }
      return 'Kernel API not available\n';
    } catch (error) {
      return `Error: ${error}\n`;
    }
  }, []);

  const sendInput = useCallback((input: string): string => {
    if (!kernelRef.current) {
      outputRef.current += input;
      return input;
    }

    try {
      if (kernelRef.current.api_shell_input) {
        const result = kernelRef.current.api_shell_input(input);
        outputRef.current += result || '';
      } else {
        outputRef.current += input;
      }
    } catch (error) {
      outputRef.current += input;
    }
    return input;
  }, []);

  const getOutput = useCallback((): string => {
    return outputRef.current;
  }, []);

  const appendOutput = useCallback((text: string) => {
    outputRef.current += text;
  }, []);

  const clearOutput = useCallback(() => {
    outputRef.current = '$ ';
  }, []);

  const getStatus = useCallback(async () => {
    if (!kernelRef.current) return null;
    try {
      if (kernelRef.current.api_get_status) {
        const status = kernelRef.current.api_get_status();
        return JSON.parse(status);
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  return useMemo(() => ({
    state,
    execute,
    sendInput,
    getOutput,
    appendOutput,
    clearOutput,
    getStatus,
    isReady: state.isReady,
    isLoading: state.isLoading,
    error: state.error
  }), [state, execute, sendInput, getOutput, appendOutput, clearOutput, getStatus]);
}