/**
 * Settings View
 * Configuration options for the binary engine
 */

import { Cpu, Shield, Globe, Bell, Palette } from 'lucide-react';
import { useState } from 'react';

interface SettingsViewProps {
  onSave: (settings: EngineSettings) => void;
}

export interface EngineSettings {
  memorySize: number;
  videoMemorySize: number;
  enableNetwork: boolean;
  enableSound: boolean;
  logLevel: number;
  theme: 'dark' | 'light' | 'auto';
  notifications: boolean;
}

export function SettingsView({ onSave }: SettingsViewProps) {
  const [settings, setSettings] = useState<EngineSettings>({
    memorySize: 128,
    videoMemorySize: 8,
    enableNetwork: false,
    enableSound: false,
    logLevel: 1,
    theme: 'dark',
    notifications: true
  });

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-view">
      <div className="settings-header">
        <div>
          <h1>Engine Settings</h1>
          <p className="header-subtitle">
            Configure emulator performance and behavior
          </p>
        </div>
        <button className="btn-primary" onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <div className="card-header">
            <Cpu size={24} style={{ color: '#00f2ff' }} />
            <h3>Performance</h3>
          </div>
          <div className="card-body">
            <div className="setting-item">
              <label>Memory Size (MB)</label>
              <input
                type="number"
                value={settings.memorySize}
                onChange={e => setSettings({ ...settings, memorySize: parseInt(e.target.value) || 128 })}
                min={64}
                max={512}
                step={32}
              />
              <small>Recommended: 128-256 MB</small>
            </div>

            <div className="setting-item">
              <label>Video Memory (MB)</label>
              <input
                type="number"
                value={settings.videoMemorySize}
                onChange={e => setSettings({ ...settings, videoMemorySize: parseInt(e.target.value) || 8 })}
                min={4}
                max={16}
                step={2}
              />
              <small>Recommended: 8 MB</small>
            </div>

            <div className="setting-item">
              <label>Log Level</label>
              <select
                value={settings.logLevel}
                onChange={e => setSettings({ ...settings, logLevel: parseInt(e.target.value) })}
              >
                <option value={0}>Silent</option>
                <option value={1}>Errors Only</option>
                <option value={2}>Warnings + Errors</option>
                <option value={3}>Verbose</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-header">
            <Globe size={24} style={{ color: '#7ee787' }} />
            <h3>Hardware</h3>
          </div>
          <div className="card-body">
            <div className="setting-item toggle">
              <div>
                <label>Enable Network</label>
                <small>Allow network access from emulator</small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.enableNetwork}
                  onChange={e => setSettings({ ...settings, enableNetwork: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="setting-item toggle">
              <div>
                <label>Enable Sound</label>
                <small>Emulate audio output</small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.enableSound}
                  onChange={e => setSettings({ ...settings, enableSound: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-header">
            <Palette size={24} style={{ color: '#d2a8ff' }} />
            <h3>Appearance</h3>
          </div>
          <div className="card-body">
            <div className="setting-item">
              <label>Theme</label>
              <select
                value={settings.theme}
                onChange={e => setSettings({ ...settings, theme: e.target.value as EngineSettings['theme'] })}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="auto">Auto (System)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-header">
            <Bell size={24} style={{ color: '#ffa657' }} />
            <h3>Notifications</h3>
          </div>
          <div className="card-body">
            <div className="setting-item toggle">
              <div>
                <label>Enable Notifications</label>
                <small>Show alerts for binary status changes</small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.notifications}
                  onChange={e => setSettings({ ...settings, notifications: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-header">
            <Shield size={24} style={{ color: '#00f2ff' }} />
            <h3>Security</h3>
          </div>
          <div className="card-body">
            <div className="security-info">
              <p>All binaries execute in a sandboxed WebAssembly environment with no direct access to:</p>
              <ul>
                <li>Host file system</li>
                <li>Host network (unless enabled)</li>
                <li>System processes</li>
                <li>Hardware devices</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
