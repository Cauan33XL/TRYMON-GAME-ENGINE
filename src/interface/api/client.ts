/**
 * TRYMON API Client
 * Communication layer between frontend and backend
 */

import { BinaryFile } from '../../wasm/v86-emulator';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface BinaryMetadata {
  id: string;
  name: string;
  size: number;
  type: 'appimage' | 'deb' | 'rpm' | 'unknown';
  uploaded_at: string;
  status: 'pending' | 'loaded' | 'running' | 'stopped' | 'error' | 'exited';
  path: string;
}

export interface ExecutionRequest {
  binaryId: string;
  args?: string[];
  captureOutput?: boolean;
  timeout?: number;
  background?: boolean;
}

export interface ExecutionResponse {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number;
  logs?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async healthCheck(): Promise<{ status: string; engine: string }> {
    return this.request('/api/health');
  }

  async listBinaries(): Promise<BinaryMetadata[]> {
    return this.request('/api/binaries');
  }

  async uploadBinary(file: File): Promise<BinaryMetadata> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/api/binaries/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  }

  async deleteBinary(id: string): Promise<void> {
    await this.request(`/api/binaries/${id}`, { method: 'DELETE' });
  }

  async getBinary(id: string): Promise<BinaryMetadata> {
    return this.request(`/api/binaries/${id}`);
  }

  async executeBinary(request: ExecutionRequest): Promise<ExecutionResponse> {
    return this.request('/api/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getExecutionStatus(executionId: string): Promise<ExecutionResponse> {
    return this.request(`/api/execute/${executionId}`);
  }

  async cancelExecution(executionId: string): Promise<void> {
    await this.request(`/api/execute/${executionId}/cancel`, {
      method: 'POST',
    });
  }

  getBinaryUrl(path: string): string {
    if (path.startsWith('http')) {
      return path;
    }
    return `${this.baseUrl}${path}`;
  }

  convertToBinaryFile(metadata: BinaryMetadata): BinaryFile {
    return {
      id: metadata.id,
      name: metadata.name,
      size: metadata.size,
      type: metadata.type,
      path: metadata.path,
      uploadedAt: new Date(metadata.uploaded_at),
      status: metadata.status,
    };
  }

  convertToBinaryMetadata(binary: BinaryFile): Partial<BinaryMetadata> {
    return {
      id: binary.id,
      name: binary.name,
      size: binary.size,
      type: binary.type,
      uploaded_at: binary.uploadedAt.toISOString(),
      status: binary.status,
      path: binary.path,
    };
  }
}

export const apiClient = new ApiClient();
export default apiClient;