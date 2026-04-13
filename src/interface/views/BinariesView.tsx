/**
 * Binaries View
 * Manages binary file uploads and execution
 */

import { BinaryUploader } from '../components/BinaryUploader';
import { BinaryList } from '../components/BinaryList';
import { BinaryFile } from '../../wasm/v86-emulator';

interface BinariesViewProps {
  files: BinaryFile[];
  onUpload: (file: File) => void;
  onExecute: (file: BinaryFile) => void;
  onStop: (file: BinaryFile) => void;
  onDelete: (id: string) => void;
  isUploading: boolean;
}

export function BinariesView({ 
  files, 
  onUpload, 
  onExecute, 
  onStop, 
  onDelete,
  isUploading 
}: BinariesViewProps) {
  return (
    <div className="binaries-view">
      <div className="binaries-header">
        <div>
          <h1>Binary Manager</h1>
          <p className="header-subtitle">
            Upload and manage Linux binaries (.AppImage, .deb, .rpm)
          </p>
        </div>
      </div>

      <div className="binaries-content">
        <div className="upload-section">
          <BinaryUploader onFileUpload={onUpload} isUploading={isUploading} />
        </div>

        <div className="binaries-list-section">
          <BinaryList 
            files={files}
            onExecute={onExecute}
            onStop={onStop}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}
