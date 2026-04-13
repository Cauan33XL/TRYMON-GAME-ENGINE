/**
 * React hooks for v86 emulator integration
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { V86Emulator, V86State, V86Config, BinaryFile, ExecutionResult } from '../../wasm/v86-emulator';

export function useEmulator(config: V86Config = {}) {
  const [state, setState] = useState<V86State>({
    isRunning: false,
    isReady: false,
    isBooted: false,
    isInitializing: false,
    error: null,
    cpuUsage: 0,
    memoryUsage: 0,
    uptime: 0,
    shellMode: true
  });

  const emulatorRef = useRef<V86Emulator | null>(null);

  useEffect(() => {
    const emulator = new V86Emulator(config);
    emulatorRef.current = emulator;

    const unsubscribe = emulator.onStateChange(setState);

    return () => {
      unsubscribe();
      emulator.cleanup();
      emulatorRef.current = null;
    };
  }, [config]);

  const initialize = useCallback(async (screenElement?: HTMLCanvasElement) => {
    setState(prev => ({ ...prev, isInitializing: true, error: null }));
    const result = await emulatorRef.current?.initialize(screenElement) ?? false;
    setState(prev => ({ ...prev, isInitializing: false }));
    return result;
  }, []);

  const start = useCallback(() => {
    emulatorRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    emulatorRef.current?.stop();
  }, []);

  const sendInput = useCallback((data: string | Uint8Array) => {
    emulatorRef.current?.sendInput(data);
  }, []);

  const executeCommand = useCallback((command: string, waitForPrompt?: boolean) => {
    return emulatorRef.current?.executeCommand(command, waitForPrompt) ?? Promise.resolve('');
  }, []);

  const mountBinary = useCallback(async (file: BinaryFile) => {
    return emulatorRef.current?.mountBinary(file) ?? false;
  }, []);

  const executeBinary = useCallback((
    file: BinaryFile, 
    options?: { captureOutput?: boolean; timeout?: number; args?: string[] }
  ): Promise<ExecutionResult> => {
    return emulatorRef.current?.executeBinary(file, options) ?? Promise.resolve({
      success: false,
      output: 'Emulator not initialized',
      exitCode: -1,
      duration: 0
    });
  }, []);

  const executeBinaryBackground = useCallback((file: BinaryFile) => {
    emulatorRef.current?.executeBinaryBackground(file);
  }, []);

  return {
    state,
    emulator: emulatorRef.current,
    initialize,
    start,
    stop,
    sendInput,
    executeCommand,
    mountBinary,
    executeBinary,
    executeBinaryBackground
  };
}

export function useTerminalOutput(emulator: V86Emulator | null) {
  const [output, setOutput] = useState<string>('');

  useEffect(() => {
    if (!emulator) return;

    const unsubscribe = emulator.onTerminalOutput((data: string) => {
      setOutput(prev => prev + data);
    });

    return unsubscribe;
  }, [emulator]);

  const clear = useCallback(() => {
    setOutput('');
  }, []);

  return { output, clear };
}

export function useBinaryFiles() {
  const [files, setFiles] = useState<BinaryFile[]>([]);

  const addFile = useCallback(async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const ext = file.name.split('.').pop()?.toLowerCase();

    let type: BinaryFile['type'] = 'unknown';
    if (ext === 'appimage') type = 'appimage';
    else if (ext === 'deb') type = 'deb';
    else if (ext === 'rpm') type = 'rpm';

    const binaryFile: BinaryFile = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type,
      data: arrayBuffer,
      uploadedAt: new Date(),
      status: 'pending'
    };

    setFiles(prev => [...prev, binaryFile]);
    return binaryFile;
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const updateFileStatus = useCallback((id: string, status: BinaryFile['status'], exitCode?: number) => {
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, status, exitCode } : f
    ));
  }, []);

  const getFile = useCallback((id: string) => {
    return files.find(f => f.id === id);
  }, [files]);

  return {
    files,
    addFile,
    removeFile,
    updateFileStatus,
    getFile
  };
}

export function useExecution() {
  return useCallback(async (
    executeFn: () => Promise<ExecutionResult>,
    onStart: () => void,
    onComplete: (result: ExecutionResult) => void
  ) => {
    onStart();
    const result = await executeFn();
    onComplete(result);
    return result;
  }, []);
}