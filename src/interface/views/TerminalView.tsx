/**
 * Terminal View
 * Provides full-screen terminal with emulator/shell integration
 */

import { Terminal as TerminalIcon, Maximize2, Minimize2 } from 'lucide-react';
import { TerminalComponent } from '../components/TerminalComponent';
import { V86State } from '../../wasm/v86-emulator';
import { useShellWasm } from '../hooks/useShellWasm';
import { useState, useCallback, useEffect } from 'react';

interface TerminalViewProps {
  emulatorState: V86State;
  onInput: (data: string) => void;
  terminalOutput: string;
  isReady: boolean;
}

export function TerminalView({ 
  emulatorState, 
  onInput, 
  terminalOutput,
  isReady 
}: TerminalViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [terminalMode, setTerminalMode] = useState<'v86' | 'shell'>('shell');
  
  const shell = useShellWasm();
  const [shellDisplay, setShellDisplay] = useState<string>('');

  useEffect(() => {
    setShellDisplay('TRYMON Shell v1.0.0 ready.\nType "help" for available commands.\n\nroot@trymon:~# ');
  }, []);

  const handleShellInput = useCallback((data: string) => {
    if (data === '\r' || data === '\n') {
      shell.appendOutput('\n');
      const currentOutput = shell.getOutput();
      
      shell.execute(currentOutput.split('\n').pop() || '').then(result => {
        shell.appendOutput(result || '');
        shell.appendOutput('\nroot@trymon:~# ');
        setShellDisplay(shell.getOutput());
      });
    } else {
      shell.sendInput(data);
      setShellDisplay(shell.getOutput());
    }
  }, [shell]);

  const handleInput = useCallback((data: string) => {
    if (terminalMode === 'shell' && shell.isReady) {
      handleShellInput(data);
    } else {
      onInput(data);
    }
  }, [terminalMode, shell.isReady, handleShellInput, onInput]);

  const getTerminalOutput = () => {
    if (terminalMode === 'shell') {
      return shellDisplay;
    }
    return terminalOutput;
  };

  const isTerminalRunning = () => {
    if (terminalMode === 'shell') {
      return shell.isReady;
    }
    return emulatorState.isRunning;
  };

  return (
    <div className={`terminal-view ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="terminal-header">
        <div className="terminal-controls">
          <div className="control-btn close" />
          <div className="control-btn minimize" />
          <div className="control-btn maximize" />
        </div>
        
        <div className="terminal-mode-selector">
          <button 
            className={`mode-btn ${terminalMode === 'shell' ? 'active' : ''}`}
            onClick={() => setTerminalMode('shell')}
          >
            Shell (Rust)
          </button>
          <button 
            className={`mode-btn ${terminalMode === 'v86' ? 'active' : ''}`}
            onClick={() => setTerminalMode('v86')}
          >
            v86 Emulator
          </button>
        </div>
        
        <div className="terminal-title">
          <TerminalIcon size={16} />
          <span>
            {terminalMode === 'shell' 
              ? `TRYMON Shell ${shell.isReady ? '(Ready)' : '(Loading...)'}`
              : `v86 Terminal ${emulatorState.isRunning ? '(Connected)' : '(Disconnected)'}`
            }
          </span>
        </div>
        
        <button 
          className="fullscreen-btn"
          onClick={() => setIsFullscreen(!isFullscreen)}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      <div className="terminal-container">
        {terminalMode === 'shell' && shell.isLoading && (
          <div className="terminal-placeholder">
            <TerminalIcon size={48} className="placeholder-icon" />
            <h3>Loading TRYMON Shell...</h3>
            <p>Initializing Rust WASM module</p>
          </div>
        )}
        
        {terminalMode === 'shell' && shell.error && (
          <div className="terminal-placeholder error">
            <TerminalIcon size={48} className="placeholder-icon" />
            <h3>Shell Error</h3>
            <p>{shell.error}</p>
            <p style={{fontSize: '12px', marginTop: '10px'}}>
              Falling back to basic terminal mode
            </p>
          </div>
        )}
        
        {(terminalMode === 'v86' || (terminalMode === 'shell' && (shell.isReady || shell.error))) && (
          <TerminalComponent
            onInput={handleInput}
            output={getTerminalOutput()}
            isRunning={isTerminalRunning()}
          />
        )}
        
        {terminalMode === 'v86' && !isReady && (
          <div className="terminal-placeholder">
            <TerminalIcon size={48} className="placeholder-icon" />
            <h3>Initializing v86 runtime...</h3>
            <p>Start the emulator to access the terminal</p>
          </div>
        )}
      </div>

      {terminalMode === 'shell' && (shell.isReady || shell.error) && (
        <div className="terminal-status-bar">
          <div className="status-indicator">
            <div className={`status-dot ${shell.isReady ? 'green' : 'yellow'}`} />
            <span>
              {shell.isReady 
                ? 'Shell Ready • Type "help" for commands' 
                : 'Shell Error • Using basic mode'}
            </span>
          </div>
        </div>
      )}

      {terminalMode === 'v86' && !emulatorState.isRunning && isReady && (
        <div className="terminal-status-bar">
          <div className="status-indicator">
            <div className="status-dot yellow" />
            <span>Emulator stopped</span>
          </div>
        </div>
      )}

      {terminalMode === 'v86' && emulatorState.isRunning && (
        <div className="terminal-status-bar">
          <div className="status-indicator">
            <div className="status-dot green" />
            <span>Connected • CPU: {emulatorState.cpuUsage.toFixed(1)}% • MEM: {emulatorState.memoryUsage.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}