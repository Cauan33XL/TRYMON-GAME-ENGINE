/**
 * Binary List Component
 * Displays uploaded binaries with status and actions
 */

import { Play, StopCircle, Trash2, FileCode, Clock } from 'lucide-react';
import { BinaryFile, formatBytes } from '../../wasm/v86-emulator';

interface BinaryListProps {
  files: BinaryFile[];
  onExecute: (file: BinaryFile) => void;
  onStop: (file: BinaryFile) => void;
  onDelete: (id: string) => void;
}

export function BinaryList({ files, onExecute, onStop, onDelete }: BinaryListProps) {
  if (files.length === 0) {
    return (
      <div className="empty-state">
        <FileCode size={48} className="empty-icon" />
        <h3>No binaries uploaded</h3>
        <p>Upload your first .AppImage, .deb, or .rpm to get started</p>
      </div>
    );
  }

  const getStatusColor = (status: BinaryFile['status']) => {
    switch (status) {
      case 'running': return '#00f2ff';
      case 'loaded': return '#7ee787';
      case 'pending': return '#ffa657';
      case 'error': return '#ff7b72';
      case 'stopped': return '#6e7681';
      default: return '#6e7681';
    }
  };

  const getStatusLabel = (status: BinaryFile['status']) => {
    switch (status) {
      case 'running': return 'Running';
      case 'loaded': return 'Ready';
      case 'pending': return 'Pending';
      case 'error': return 'Error';
      case 'stopped': return 'Stopped';
      case 'exited': return 'Exited';
      default: return 'Unknown';
    }
  };

  return (
    <div className="binary-list">
      <h3 className="list-header">Uploaded Binaries ({files.length})</h3>

      <div className="binary-cards">
        {files.map((file, index) => (
          <div key={`${file.name}-${index}`} className="binary-card">
            <div className="card-header">
              <div className="file-icon">
                {file.metadata?.icon ? (
                  <img src={file.metadata.icon} alt="icon" className="binary-icon-img" />
                ) : (
                  <FileCode size={24} />
                )}
              </div>
              <div className="file-info">
                <h4 className="file-name" title={file.name}>{file.name}</h4>
                <div className="file-meta">
                  <span className="file-size">{formatBytes(file.size)}</span>
                  <span className="file-type">.{file.type}</span>
                  {file.metadata?.maintainer && (
                    <span className="file-author">by {file.metadata.maintainer}</span>
                  )}
                </div>
              </div>
              <div
                className="status-badge"
                style={{ borderColor: getStatusColor(file.status) }}
              >
                <div
                  className="status-dot"
                  style={{ backgroundColor: getStatusColor(file.status) }}
                />
                {getStatusLabel(file.status)}
              </div>
            </div>

            <div className="card-details">
              <div className="detail-item">
                <Clock size={14} />
                <span>Uploaded {file.uploadedAt.toLocaleTimeString()}</span>
              </div>
              {file.metadata?.description && (
                <div className="detail-item description">
                  <p>{file.metadata.description}</p>
                </div>
              )}
            </div>

            <div className="card-actions">
              {file.status === 'loaded' || file.status === 'stopped' ? (
                <button
                  className="action-btn execute"
                  onClick={() => onExecute(file)}
                  disabled={file.status !== 'loaded' && file.status !== 'stopped'}
                >
                  <Play size={16} />
                  Execute
                </button>
              ) : file.status === 'running' ? (
                <button
                  className="action-btn stop"
                  onClick={() => onStop(file)}
                >
                  <StopCircle size={16} />
                  Stop
                </button>
              ) : (
                <button className="action-btn disabled" disabled>
                  {file.status === 'pending' ? 'Loading...' : 'Error'}
                </button>
              )}

              <button
                className="action-btn delete"
                onClick={() => onDelete(file.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
