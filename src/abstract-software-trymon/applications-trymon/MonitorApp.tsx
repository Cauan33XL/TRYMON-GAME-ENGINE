import type { V86State } from '../../wasm/v86-emulator';
import { useTrymonApps, getTVMSandboxStatus } from '../../interface/hooks/useKernelState';

export default function MonitorApp({ kernelState, emulatorState }: { kernelState: any; emulatorState: V86State }) {
  const cpuUsage = emulatorState.cpuUsage || 0;
  const memoryUsage = emulatorState.memoryUsage || 0;
  const uptime = kernelState.uptime || emulatorState.uptime || 0;
  const isRunning = emulatorState.isRunning;
  const kernelReady = kernelState.initialized;
  
  // Trymon Apps info
  const trymonApps = useTrymonApps();
  const installedApps = trymonApps.apps.length;

  // Get TVM stats
  const tvmStats = getTVMSandboxStatus();

  return (
    <div className="monitor-window">
      <div className="monitor-header">
        <h3>Recursos do Sistema</h3>
      </div>
      <div className="monitor-stats">
        <div className="stat-card">
          <div className="stat-header">
            <h4>Uso de CPU</h4>
            <span className="stat-value">{cpuUsage.toFixed(1)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress" style={{ width: `${Math.min(cpuUsage, 100)}%` }} />
          </div>
          <div className="stat-details">
            <span>4 núcleos disponíveis</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <h4>Memória</h4>
            <span className="stat-value">{memoryUsage.toFixed(1)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress memory" style={{ width: `${Math.min(memoryUsage, 100)}%` }} />
          </div>
          <div className="stat-details">
            <span>128 MB total</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <h4>Uptime</h4>
            <span className="stat-value">{Math.floor(uptime / 3600)}h {Math.floor((uptime % 3600) / 60)}m</span>
          </div>
          <div className="uptime-chart">
            <div className="uptime-bar" style={{ width: `${Math.min((uptime % 3600) / 36, 100)}%` }} />
          </div>
        </div>
        <div className="stat-card status-card">
          <div className="stat-header">
            <h4>Status do Sistema</h4>
          </div>
          <div className="status-indicators">
            <div className={`status-item ${isRunning ? 'running' : 'stopped'}`}>
              <span className="status-dot" />
              <span>Emulador v86</span>
              <span className="status-text">{isRunning ? 'Executando' : 'Parado'}</span>
            </div>
            <div className={`status-item ${kernelReady ? 'running' : 'stopped'}`}>
              <span className="status-dot" />
              <span>Kernel Rust</span>
              <span className="status-text">{kernelReady ? 'Online' : 'Offline'}</span>
            </div>
            <div className={`status-item ${installedApps > 0 ? 'running' : 'stopped'}`}>
              <span className="status-dot" />
              <span>TVM Engine</span>
              <span className="status-text">{installedApps > 0 ? `${installedApps} apps` : 'Pronto'}</span>
            </div>
            {tvmStats && (
              <div className="status-item running">
                <span className="status-dot" />
                <span>TVM Sandbox</span>
                <span className="status-text">Ativo</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
