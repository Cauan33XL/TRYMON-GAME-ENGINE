/**
 * API Hooks for Trymon OS
 * Integration layer for backend communication
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient, BinaryMetadata, ExecutionRequest } from '../api/client';

export function useApi() {
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  return { error, clearError };
}

export function useBinaries() {
  const [binaries, setBinaries] = useState<BinaryMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBinaries = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.listBinaries();
      setBinaries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch binaries');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const uploadBinary = useCallback(async (file: File): Promise<BinaryMetadata | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const binary = await apiClient.uploadBinary(file);
      setBinaries(prev => [binary, ...prev]);
      return binary;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload binary');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteBinary = useCallback(async (id: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiClient.deleteBinary(id);
      setBinaries(prev => prev.filter(b => b.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete binary');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getBinary = useCallback(async (id: string): Promise<BinaryMetadata | null> => {
    try {
      return await apiClient.getBinary(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get binary');
      return null;
    }
  }, []);

  useEffect(() => {
    fetchBinaries();
  }, [fetchBinaries]);

  return {
    binaries,
    isLoading,
    error,
    fetchBinaries,
    uploadBinary,
    deleteBinary,
    getBinary,
  };
}

export function useExecution() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (request: ExecutionRequest) => {
    setIsExecuting(true);
    setError(null);
    setResult(null);
    try {
      const executionResult = await apiClient.executeBinary(request);
      setResult(executionResult);
      return executionResult;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
      return null;
    } finally {
      setIsExecuting(false);
    }
  }, []);

  const getStatus = useCallback(async (executionId: string) => {
    try {
      return await apiClient.getExecutionStatus(executionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get status');
      return null;
    }
  }, []);

  const cancel = useCallback(async (executionId: string) => {
    try {
      await apiClient.cancelExecution(executionId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
      return false;
    }
  }, []);

  return {
    isExecuting,
    result,
    error,
    execute,
    getStatus,
    cancel,
  };
}

export function useBinaryUrl() {
  return useCallback((path: string) => {
    return apiClient.getBinaryUrl(path);
  }, []);
}