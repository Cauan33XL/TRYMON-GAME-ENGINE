/**
 * Binary Uploader Component
 * Handles drag-and-drop and file selection for binary uploads
 */

import { useState, useCallback, DragEvent, ChangeEvent } from 'react';
import { Upload, FileCode, AlertCircle, Package, Check, X } from 'lucide-react';
import { detectBinaryType } from '../../wasm/v86-emulator';
import { TrymonPackage, TrymonMetadata } from '../../bridge/trymonPackage';

interface BinaryUploaderProps {
  onFileUpload: (file: File) => void;
  isUploading?: boolean;
}

export function BinaryUploader({ onFileUpload, isUploading }: BinaryUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const [metadata, setMetadata] = useState<TrymonMetadata>({
    name: '',
    maintainer: '',
    description: '',
    version: '1.0.0',
    icon: ''
  });

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
      setError(`Unsupported file type: ${file.name}. Please upload .AppImage, .deb, .rpm or .trymon files.`);
      return;
    }
    if (type === 'trymon') {
      onFileUpload(file);
      return;
    }

    setPendingFile(file);
    setMetadata(prev => ({ ...prev, name: file.name.split('.')[0] }));
    setShowMetadataForm(true);
  };

  const handlePackAndUpload = async () => {
    if (!pendingFile) return;

    try {
      const buffer = await pendingFile.arrayBuffer();
      const binary = new Uint8Array(buffer);
      const trymonPackage = TrymonPackage.create(binary, metadata);
      
      const blob = new Blob([trymonPackage.buffer as ArrayBuffer], { type: 'application/octet-stream' });
      const packedFile = new File([blob], `${metadata.name}.trymon`, { type: 'application/octet-stream' });
      
      onFileUpload(packedFile);
      setShowMetadataForm(false);
      setPendingFile(null);
    } catch (err) {
      setError('Failed to pack .trymon package');
    }
  };

  const handleSkipConversion = () => {
    if (pendingFile) {
      onFileUpload(pendingFile);
      setPendingFile(null);
      setShowMetadataForm(false);
    }
  };

  const handleIconChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setMetadata(prev => ({ ...prev, icon: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const acceptedTypes = '.appimage,.deb,.rpm,.trymon';

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
        ) : showMetadataForm ? (
          <div className="metadata-form">
            <Package size={48} className="form-icon" />
            <h3>Configure .trymon Package</h3>
            <p>Convert "{pendingFile?.name}" to a rich Trymon OS app.</p>
            
            <div className="form-grid">
              <div className="form-group">
                <label>App Name</label>
                <input 
                  type="text" 
                  value={metadata.name} 
                  onChange={e => setMetadata({...metadata, name: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label>Author</label>
                <input 
                  type="text" 
                  value={metadata.maintainer} 
                  onChange={e => setMetadata({...metadata, maintainer: e.target.value})} 
                />
              </div>
              <div className="form-group full-width">
                <label>Description</label>
                <textarea 
                  value={metadata.description} 
                  onChange={e => setMetadata({...metadata, description: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label>Icon</label>
                <div className="icon-upload-wrapper">
                  {metadata.icon && <img src={metadata.icon} alt="icon" className="preview-icon" />}
                  <input type="file" accept="image/*" onChange={handleIconChange} id="icon-input" />
                  <label htmlFor="icon-input" className="icon-label">Select Icon</label>
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button className="skip-btn" onClick={handleSkipConversion}>
                <X size={16} /> Skip & Upload Raw
              </button>
              <button className="confirm-btn" onClick={handlePackAndUpload}>
                <Check size={16} /> Pack & Upload
              </button>
            </div>
          </div>
        ) : (
          <>
            <Upload size={64} className="upload-icon" />
            <h3 className="upload-title">
              {isDragging ? 'Drop your binary here' : 'Upload Binary'}
            </h3>
            <p className="upload-subtitle">
              Drag & drop .AppImage, .deb, .rpm or .trymon files
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

      {!showMetadataForm && (
        <div className="supported-formats">
          <h4>Supported Formats</h4>
          <div className="format-badges">
            <span className="badge badge-appimage">.AppImage</span>
            <span className="badge badge-deb">.deb</span>
            <span className="badge badge-rpm">.rpm</span>
            <span className="badge badge-trymon">.trymon [Premium]</span>
          </div>
          <p className="format-info">
            Maximum file size: 2GB | Trymon packages include icons and rich metadata
          </p>
        </div>
      )}
    </div>
  );
}
