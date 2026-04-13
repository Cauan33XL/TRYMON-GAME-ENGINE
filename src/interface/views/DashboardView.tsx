/**
 * Dashboard View
 * Displays system health, emulator status, and quick actions
 */

import { Cpu, MemoryStick, Clock, Shield, Activity, Terminal, Upload } from 'lucide-react';
import { StatusCard } from '../components/StatusCard';
import { V86State, formatUptime } from '../../wasm/v86-emulator';

interface DashboardViewProps {
  emulatorState: V86State;
  binaryCount: number;
  onStartEmulator: () => void;
  onStopEmulator: () => void;
  onNavigate: (tab: string) => void;
}

export function DashboardView({ 
  emulatorState, 
  binaryCount,
  onStartEmulator, 
  onStopEmulator,
  onNavigate 
}: DashboardViewProps) {
  return (
    <div className="dashboard-view">
      <div className="dashboard-header">
        <div>
          <h1>System Dashboard</h1>
          <p className="header-subtitle">Monitor and manage your binary runtime environment</p>
        </div>
        <div className="header-actions">
          {emulatorState.isInitializing ? (
            <button className="btn-primary disabled" disabled>
              <Activity size={18} className="rotating" />
              Initializing...
            </button>
          ) : !emulatorState.isRunning ? (
            <button className="btn-primary" onClick={onStartEmulator}>
              <Activity size={18} />
              Start Emulator
            </button>
          ) : (
            <button className="btn-danger" onClick={onStopEmulator}>
              <Activity size={18} />
              Stop Emulator
            </button>
          )}
        </div>

      </div>

      <div className="status-grid">
        <StatusCard
          icon={Cpu}
          title="CPU Usage"
          value={`${emulatorState.cpuUsage.toFixed(1)}%`}
          subtitle={emulatorState.isRunning ? 'Active' : 'Idle'}
          trend={emulatorState.isRunning ? 'up' : 'stable'}
          color="#00f2ff"
        />
        
        <StatusCard
          icon={MemoryStick}
          title="Memory Usage"
          value={`${emulatorState.memoryUsage.toFixed(1)}%`}
          subtitle={`${(emulatorState.memoryUsage * 1.28).toFixed(0)} MB / 128 MB`}
          trend={emulatorState.isRunning ? 'up' : 'stable'}
          color="#7ee787"
        />
        
        <StatusCard
          icon={Clock}
          title="Uptime"
          value={formatUptime(emulatorState.uptime)}
          subtitle={emulatorState.isRunning ? 'Running' : 'Stopped'}
          color="#ffa657"
        />
        
        <StatusCard
          icon={Terminal}
          title="Binaries"
          value={binaryCount.toString()}
          subtitle="Uploaded files"
          color="#d2a8ff"
        />
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <div className="card-header">
            <Shield size={24} style={{ color: '#00f2ff' }} />
            <h3>Security Status</h3>
          </div>
          <div className="card-content">
            <div className="security-item">
              <div className="indicator green" />
              <div>
                <h4>Sandbox Active</h4>
                <p>All binaries execute in isolated environment</p>
              </div>
            </div>
            <div className="security-item">
              <div className="indicator green" />
              <div>
                <h4>Network Isolation</h4>
                <p>No external network access by default</p>
              </div>
            </div>
            <div className="security-item">
              <div className="indicator green" />
              <div>
                <h4>File System Sandboxing</h4>
                <p>Limited to virtual filesystem only</p>
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <Activity size={24} style={{ color: '#7ee787' }} />
            <h3>Quick Actions</h3>
          </div>
          <div className="card-content">
            <button className="quick-action" onClick={() => onNavigate('binaries')}>
              <Upload size={20} />
              <div className="action-text">
                <span>Upload Binary</span>
                <small>Add .AppImage, .deb, or .rpm</small>
              </div>
            </button>
            <button className="quick-action" onClick={() => onNavigate('terminal')}>
              <Terminal size={20} />
              <div className="action-text">
                <span>Open Terminal</span>
                <small>Access command line interface</small>
              </div>
            </button>
            <button className="quick-action" onClick={() => onNavigate('monitoring')}>
              <Activity size={20} />
              <div className="action-text">
                <span>View Monitoring</span>
                <small>Check system metrics and logs</small>
              </div>
            </button>
          </div>
        </div>
      </div>

      {emulatorState.error && (
        <div className="error-banner">
          <strong>Error:</strong> {emulatorState.error}
        </div>
      )}
    </div>
  );
}
