/**
 * Monitoring View
 * Displays real-time system metrics and process information
 */

import { Activity, Cpu, MemoryStick, HardDrive, Network, Clock, AlertTriangle } from 'lucide-react';
import { V86State, formatUptime } from '../../wasm/v86-emulator';

interface MonitoringViewProps {
  emulatorState: V86State;
}

export function MonitoringView({ emulatorState }: MonitoringViewProps) {
  // Simulated process list (in real implementation, this would come from emulator)
  const processes = emulatorState.isRunning ? [
    { pid: 1, name: 'init', cpu: 0.1, memory: 0.5, status: 'Running' },
    { pid: 124, name: 'systemd-journald', cpu: 0.3, memory: 1.2, status: 'Running' },
    { pid: 256, name: 'bash', cpu: 0.0, memory: 0.8, status: 'Running' },
    { pid: 312, name: 'v86-runtime', cpu: emulatorState.cpuUsage, memory: emulatorState.memoryUsage, status: 'Running' },
  ] : [];

  return (
    <div className="monitoring-view">
      <div className="monitoring-header">
        <div>
          <h1>System Monitoring</h1>
          <p className="header-subtitle">
            Real-time system metrics and process monitoring
          </p>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <Cpu size={20} />
            <span>CPU Usage</span>
          </div>
          <div className="metric-value">
            <div className="metric-bar">
              <div 
                className="metric-fill" 
                style={{ 
                  width: `${emulatorState.cpuUsage}%`,
                  backgroundColor: emulatorState.cpuUsage > 80 ? '#ff7b72' : '#00f2ff'
                }}
              />
            </div>
            <span>{emulatorState.cpuUsage.toFixed(1)}%</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <MemoryStick size={20} />
            <span>Memory</span>
          </div>
          <div className="metric-value">
            <div className="metric-bar">
              <div 
                className="metric-fill" 
                style={{ 
                  width: `${emulatorState.memoryUsage}%`,
                  backgroundColor: emulatorState.memoryUsage > 80 ? '#ff7b72' : '#7ee787'
                }}
              />
            </div>
            <span>{emulatorState.memoryUsage.toFixed(1)}%</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <Clock size={20} />
            <span>Uptime</span>
          </div>
          <div className="metric-value simple">
            {formatUptime(emulatorState.uptime)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HardDrive size={20} />
            <span>Disk I/O</span>
          </div>
          <div className="metric-value simple">
            {emulatorState.isRunning ? 'Active' : 'Idle'}
          </div>
        </div>
      </div>

      <div className="processes-section">
        <h3>
          <Activity size={18} />
          Processes
        </h3>
        
        {!emulatorState.isRunning ? (
          <div className="empty-state small">
            <AlertTriangle size={32} className="empty-icon" />
            <p>Start the emulator to view processes</p>
          </div>
        ) : (
          <div className="process-table">
            <div className="table-header">
              <span>PID</span>
              <span>Process</span>
              <span>CPU %</span>
              <span>MEM %</span>
              <span>Status</span>
            </div>
            {processes.map(proc => (
              <div key={proc.pid} className="table-row">
                <span>{proc.pid}</span>
                <span className="process-name">{proc.name}</span>
                <span>{proc.cpu.toFixed(1)}%</span>
                <span>{proc.memory.toFixed(1)}%</span>
                <span className="status-running">{proc.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="logs-section">
        <h3>
          <Network size={18} />
          System Logs
        </h3>
        <div className="log-container">
          {!emulatorState.isRunning ? (
            <div className="log-empty">
              <p>Start the emulator to view system logs</p>
            </div>
          ) : (
            <div className="log-entries">
              <div className="log-entry">
                <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
                <span className="log-level info">INFO</span>
                <span className="log-message">v86 emulator started successfully</span>
              </div>
              <div className="log-entry">
                <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
                <span className="log-level info">INFO</span>
                <span className="log-message">Memory allocated: 128 MB</span>
              </div>
              <div className="log-entry">
                <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
                <span className="log-level success">SUCCESS</span>
                <span className="log-message">Virtual filesystem initialized</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
