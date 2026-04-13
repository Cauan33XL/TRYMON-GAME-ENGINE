/**
 * Binary Uploader Component
 * Handles drag-and-drop and file selection for binary uploads
 */

import { useState, useCallback, DragEvent, ChangeEvent } from 'react';
import { Upload, FileCode, AlertCircle } from 'lucide-react';
import { detectBinaryType } from '../../wasm/v86-emulator';

interface BinaryUploaderProps {
  onFileUpload: (file: File) => void;
  isUploading?: boolean;
}

export function BinaryUploader({ onFileUpload, isUploading }: BinaryUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setError(null);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  }, []);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  }, []);

  const handleFile = (file: File) => {
    const type = detectBinaryType(file.name);

    if (type === 'unknown') {
      setError(`Unsupported file type: ${file.name}. Please upload .AppImage, .deb, or .rpm files.`);
      return;
    }

    onFileUpload(file);
  };

  const acceptedTypes = '.appimage,.deb,.rpm';

  return (
    <div className="binary-uploader">
      <div
        className={`upload-zone ${isDragging ? 'dragging' : ''} ${error ? 'error' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isUploading ? (
          <div className="upload-progress">
            <div className="spinner" />
            <p>Processing binary...</p>
          </div>
        ) : error ? (
          <div className="upload-error">
            <AlertCircle size={48} className="error-icon" />
            <p className="error-message">{error}</p>
            <button className="retry-btn" onClick={() => setError(null)}>
              Try Again
            </button>
          </div>
        ) : (
          <>
            <Upload size={64} className="upload-icon" />
            <h3 className="upload-title">
              {isDragging ? 'Drop your binary here' : 'Upload Binary'}
            </h3>
            <p className="upload-subtitle">
              Drag & drop .AppImage, .deb, or .rpm files
            </p>
            <label className="upload-button">
              <input
                type="file"
                accept={acceptedTypes}
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <FileCode size={16} style={{ marginRight: 8 }} />
              Browse Files
            </label>
          </>
        )}
      </div>

      <div className="supported-formats">
        <h4>Supported Formats</h4>
        <div className="format-badges">
          <span className="badge badge-appimage">.AppImage</span>
          <span className="badge badge-deb">.deb</span>
          <span className="badge badge-rpm">.rpm</span>
        </div>
        <p className="format-info">
          Maximum file size: 2GB | All binaries run in sandboxed environment
        </p>
      </div>
    </div>
  );
}
