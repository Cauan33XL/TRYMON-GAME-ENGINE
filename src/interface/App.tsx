/**
 * Main Application Component
 * TRYMON Binary Engine - OS Desktop Interface
 * Complete window management, drag, resize, and tabs
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useEmulator, useBinaryFiles } from './hooks/useEmulator';
import { useShellWasm } from './hooks/useShellWasm';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import TrymonLogo from './components/TrymonLogo';
import { Cpu, Terminal, FolderOpen, Settings, Activity, FileCode, X, Minus, Square, Maximize2, Plus, RefreshCw, Info, Image as ImageIcon, Search, Power, User, ChevronRight } from 'lucide-react';
import type { BinaryFile, V86State } from '../wasm/v86-emulator';

interface WindowPosition {
  x: number;
  y: number;
}

interface WindowSize {
  width: number;
  height: number;
}

interface Window {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
  isMinimized: boolean;
  isMaximized: boolean;
  position: WindowPosition;
  size: WindowSize;
  zIndex: number;
  minSize: WindowSize;
  resizable: boolean;
}

interface DesktopIcon {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  x: number;
  y: number;
}

function BootScreen({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Inicializando...');
  const [dots, setDots] = useState('');
  const stepRef = useRef(0);

  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 300);

    const stepData = [
      { progress: 10, status: 'Carregando kernel...' },
      { progress: 25, status: 'Inicializando memória virtual...' },
      { progress: 40, status: 'Mounting filesystem...' },
      { progress: 55, status: 'Carregando módulos do sistema...' },
      { progress: 70, status: 'Starting services...' },
      { progress: 85, status: 'Configurando rede...' },
      { progress: 95, status: 'Inicializando shell...' },
      { progress: 100, status: 'Pronto!' },
    ];

    const advanceStep = () => {
      if (stepRef.current < stepData.length) {
        setProgress(stepData[stepRef.current].progress);
        setStatus(stepData[stepRef.current].status);
        stepRef.current++;
        if (stepRef.current < stepData.length) {
          setTimeout(advanceStep, 400);
        } else {
          setTimeout(onComplete, 500);
        }
      }
    };

    setTimeout(advanceStep, 400);

    return () => {
      clearInterval(dotInterval);
    };
  }, [onComplete]);

  return (
    <div className="boot-screen">
      <div className="boot-logo">
        <div className="boot-icon">
          <TrymonLogo size={80} glow />
        </div>
        <h1>TRYMON OS</h1>
        <p className="boot-version">Version 1.0.0</p>
      </div>
      <div className="boot-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="progress-status">{status}{dots}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [windows, setWindows] = useState<Window[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [wallpaper] = useState('linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)');
  
  const [draggingWindow, setDraggingWindow] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizingWindow, setResizingWindow] = useState<{ id: string; direction: string } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [selection, setSelection] = useState<{ active: boolean; startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [draggingIconId, setDraggingIconId] = useState<string | null>(null);
  const [iconDragOffset, setIconDragOffset] = useState({ x: 0, y: 0 });
  const iconDraggedRef = useRef(false);

  const desktopRef = useRef<HTMLDivElement>(null);

  const {
    state: emulatorState,
    initialize,
    start,
    stop,
    mountBinary,
    executeBinary,
    listApps,
    runApp
  } = useEmulator({
    memorySize: 128,
    videoMemorySize: 8,
    autostart: false
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [installedApps, setInstalledApps] = useState<any[]>([]);

  // Refresh apps list when menu opens
  useEffect(() => {
    if (startMenuOpen && emulatorState.isReady) {
      const apps = listApps();
      setInstalledApps(apps);
    }
  }, [startMenuOpen, emulatorState.isReady, listApps]);

  const { files, addFile, removeFile } = useBinaryFiles();
  const shell = useShellWasm();

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const openWindow = useCallback((id: string, title: string, icon: React.ReactNode, content: React.ReactNode) => {
    const existing = windows.find(w => w.id === id);
    if (existing) {
      if (existing.isMinimized) {
        setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: false } : w));
      }
      setActiveWindowId(id);
      bringToFront(id);
      return;
    }

    const offset = windows.length * 30;
    const newWindow: Window = {
      id,
      title,
      icon,
      content,
      isMinimized: false,
      isMaximized: false,
      position: { x: 100 + offset, y: 80 + offset },
      size: { width: 900, height: 600 },
      zIndex: windows.length + 1,
      minSize: { width: 400, height: 300 },
      resizable: true
    };

    setWindows(prev => [...prev, newWindow]);
    setActiveWindowId(id);
  }, [windows]);

  const bringToFront = useCallback((id: string) => {
    setActiveWindowId(id);
    setWindows(prev => {
      const maxZ = Math.max(...prev.map(w => w.zIndex));
      return prev.map(w => w.id === id ? { ...w, zIndex: maxZ + 1 } : w);
    });
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
    if (activeWindowId === id) {
      const remaining = windows.filter(w => w.id !== id);
      if (remaining.length > 0) {
        setActiveWindowId(remaining[remaining.length - 1].id);
      } else {
        setActiveWindowId(null);
      }
    }
  }, [activeWindowId, windows]);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: true } : w));
    if (activeWindowId === id) {
      const visible = windows.filter(w => !w.isMinimized && w.id !== id);
      if (visible.length > 0) {
        setActiveWindowId(visible[visible.length - 1].id);
      } else {
        setActiveWindowId(null);
      }
    }
  }, [activeWindowId, windows]);

  const toggleMaximize = useCallback((id: string) => {
    setWindows(prev => prev.map(w => {
      if (w.id === id) {
        if (w.isMaximized) {
          return { ...w, isMaximized: false, position: w.position, size: w.size };
        } else {
          return { ...w, isMaximized: true };
        }
      }
      return w;
    }));
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent, windowId: string) => {
    e.preventDefault();
    const win = windows.find(w => w.id === windowId);
    if (!win || win.isMaximized) return;

    setDraggingWindow(windowId);
    setDragOffset({
      x: e.clientX - win.position.x,
      y: e.clientY - win.position.y
    });
  }, [windows]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!draggingWindow) return;

    const newX = Math.max(0, e.clientX - dragOffset.x);
    const newY = Math.max(0, e.clientY - dragOffset.y);

    setWindows(prev => prev.map(w => {
      if (w.id === draggingWindow && !w.isMaximized) {
        return { ...w, position: { x: newX, y: newY } };
      }
      return w;
    }));
  }, [draggingWindow, dragOffset]);

  const handleDragEnd = useCallback(() => {
    setDraggingWindow(null);
  }, []);

  useEffect(() => {
    if (draggingWindow) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [draggingWindow, handleDragMove, handleDragEnd]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent, windowId: string, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    const win = windows.find(w => w.id === windowId);
    if (!win || win.isMaximized) return;

    setResizingWindow({ id: windowId, direction });
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: win.size.width,
      height: win.size.height
    });
  }, [windows]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingWindow || !resizeStart) return;

    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    const win = windows.find(w => w.id === resizingWindow.id);
    if (!win) return;

    let newWidth = resizeStart.width;
    let newHeight = resizeStart.height;
    let newX = win.position.x;
    let newY = win.position.y;

    if (resizingWindow.direction.includes('e')) {
      newWidth = Math.max(win.minSize.width, resizeStart.width + dx);
    }
    if (resizingWindow.direction.includes('w')) {
      const widthChange = Math.min(dx, resizeStart.width - win.minSize.width);
      newWidth = resizeStart.width - widthChange;
      newX = win.position.x + widthChange;
    }
    if (resizingWindow.direction.includes('s')) {
      newHeight = Math.max(win.minSize.height, resizeStart.height + dy);
    }
    if (resizingWindow.direction.includes('n')) {
      const heightChange = Math.min(dy, resizeStart.height - win.minSize.height);
      newHeight = resizeStart.height - heightChange;
      newY = win.position.y + heightChange;
    }

    setWindows(prev => prev.map(w => {
      if (w.id === resizingWindow.id) {
        return { ...w, size: { width: newWidth, height: newHeight }, position: { x: newX, y: newY } };
      }
      return w;
    }));
  }, [resizingWindow, resizeStart, windows]);

  const handleResizeEnd = useCallback(() => {
    setResizingWindow(null);
    setResizeStart(null);
  }, []);

  useEffect(() => {
    if (resizingWindow) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [resizingWindow, handleResizeMove, handleResizeEnd]);

  const handleStartEmulator = useCallback(async () => {
    await initialize();
    start();
  }, [initialize, start]);

  const handleStopEmulator = useCallback(() => {
    stop();
  }, [stop]);

  // Desktop Icons State
  const [icons, setIcons] = useState<DesktopIcon[]>([]);

  useEffect(() => {
    // Only initialize if icons list is empty to prevent resetting positions
    setIcons(prev => {
      if (prev.length > 0) return prev;
      
      const GRID_X = 100;
      const GRID_Y = 110;
      const MARGIN = 20;

      return [
        { id: 'terminal', label: 'Terminal', icon: <Terminal size={32} />, onClick: () => openWindow('terminal', 'Terminal', <Terminal size={16} />, <TerminalWindow shell={shell} />), x: MARGIN, y: MARGIN },
        { id: 'files', label: 'Arquivos', icon: <FolderOpen size={32} />, onClick: () => openWindow('files', 'Gerenciador de Arquivos', <FolderOpen size={16} />, <FilesWindow files={files} onUpload={handleUpload} onDelete={handleDelete} onContextMenu={handleContextMenu} />), x: MARGIN, y: MARGIN + GRID_Y },
        { id: 'binaries', label: 'Binários', icon: <FileCode size={32} />, onClick: () => openWindow('binaries', 'Gerenciador de Binários', <FileCode size={16} />, <BinariesWindow files={files} onUpload={handleUpload} onDelete={handleDelete} onContextMenu={handleContextMenu} onExecute={async (f) => { await mountBinary(f); executeBinary(f, { captureOutput: true }); }} />), x: MARGIN, y: MARGIN + GRID_Y * 2 },
        { id: 'settings', label: 'Configurações', icon: <Settings size={32} />, onClick: () => openWindow('settings', 'Configurações do Sistema', <Settings size={16} />, <SettingsWindow />), x: MARGIN, y: MARGIN + GRID_Y * 3 },
        { id: 'monitor', label: 'Monitor', icon: <Activity size={32} />, onClick: () => openWindow('monitor', 'Monitor do Sistema', <Activity size={16} />, <MonitorWindow state={emulatorState} />), x: MARGIN, y: MARGIN + GRID_Y * 4 },
      ];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.isReady]);

  // Icon Dragging Handlers
  const handleIconMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Avoid desktop selection
    if (e.button !== 0) return;

    const icon = icons.find(i => i.id === id);
    if (!icon) return;

    setDraggingIconId(id);
    iconDraggedRef.current = false;
    setIconDragOffset({
      x: e.clientX - icon.x,
      y: e.clientY - icon.y
    });
  }, [icons]);

  const handleIconMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingIconId) return;
    iconDraggedRef.current = true;

    const newX = e.clientX - iconDragOffset.x;
    const newY = e.clientY - iconDragOffset.y;

    setIcons(prev => prev.map(icon => 
      icon.id === draggingIconId ? { ...icon, x: newX, y: newY } : icon
    ));
  }, [draggingIconId, iconDragOffset]);

  const GRID_SIZE_X = 100;
  const GRID_SIZE_Y = 110;
  const MARGIN = 20;

  const handleIconMouseUp = useCallback(() => {
    if (!draggingIconId) return;

    setIcons(prev => {
      const draggedIcon = prev.find(i => i.id === draggingIconId);
      if (!draggedIcon) return prev;

      // Snap to grid
      const snappedX = Math.max(MARGIN, Math.round((draggedIcon.x - MARGIN) / GRID_SIZE_X) * GRID_SIZE_X + MARGIN);
      const snappedY = Math.max(MARGIN, Math.round((draggedIcon.y - MARGIN) / GRID_SIZE_Y) * GRID_SIZE_Y + MARGIN);

      // Simple collision resolution (spiral-like search)
      let finalX = snappedX;
      let finalY = snappedY;
      let offset = 0;
      let direction = 0; // 0: Right, 1: Down, 2: Left, 3: Up

      const isOccupied = (x: number, y: number, id: string) => 
        prev.some(icon => icon.id !== id && icon.x === x && icon.y === y);

      while (isOccupied(finalX, finalY, draggingIconId)) {
        // Change direction every 2 steps at the same distance
        if (offset % 10 === 0) direction = (direction + 1) % 4;
        
        if (direction === 0) finalX += GRID_SIZE_X;
        else if (direction === 1) finalY += GRID_SIZE_Y;
        else if (direction === 2) finalX -= GRID_SIZE_X;
        else if (direction === 3) finalY -= GRID_SIZE_Y;
        
        finalX = Math.max(MARGIN, finalX);
        finalY = Math.max(MARGIN, finalY);
        offset++;

        if (offset > 100) break; // Safety break
      }

      return prev.map(icon => 
        icon.id === draggingIconId ? { ...icon, x: finalX, y: finalY } : icon
      );
    });

    setDraggingIconId(null);
  }, [draggingIconId]);

  useEffect(() => {
    if (draggingIconId) {
      window.addEventListener('mousemove', handleIconMouseMove);
      window.addEventListener('mouseup', handleIconMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleIconMouseMove);
        window.removeEventListener('mouseup', handleIconMouseUp);
      };
    }
  }, [draggingIconId, handleIconMouseMove, handleIconMouseUp]);

  // Desktop Selection Handlers
  const handleDesktopMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    if (e.target !== desktopRef.current) return; // Only if clicking on the background

    setSelection({
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY
    });
  }, []);

  const handleDesktopMouseMove = useCallback((e: MouseEvent) => {
    if (!selection?.active) return;
    
    setSelection(prev => prev ? {
      ...prev,
      endX: e.clientX,
      endY: e.clientY
    } : null);
  }, [selection]);

  const handleDesktopMouseUp = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    if (selection?.active) {
      window.addEventListener('mousemove', handleDesktopMouseMove);
      window.addEventListener('mouseup', handleDesktopMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleDesktopMouseMove);
        window.removeEventListener('mouseup', handleDesktopMouseUp);
      };
    }
  }, [selection?.active, handleDesktopMouseMove, handleDesktopMouseUp]);

  const handleUpload = useCallback(async (file: File) => {
    await addFile(file);
  }, [addFile]);

  const handleDelete = useCallback((id: string) => {
    removeFile(id);
  }, [removeFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const desktopContextMenu: ContextMenuItem[] = [
    { label: 'Abrir Terminal', icon: <Terminal size={14} />, onClick: () => icons.find((i: DesktopIcon) => i.id === 'terminal')?.onClick() },
    { label: 'Novo Arquivo', icon: <FileCode size={14} />, onClick: () => console.log('Novo arquivo') },
    { separator: true },
    { label: 'Atualizar', icon: <RefreshCw size={14} />, onClick: () => window.location.reload() },
    { label: 'Alterar Wallpaper', icon: <ImageIcon size={14} />, onClick: () => console.log('Wallpaper alteration') },
    { separator: true },
    { label: 'Configurações', icon: <Settings size={14} />, onClick: () => icons.find((i: DesktopIcon) => i.id === 'settings')?.onClick() },
    { label: 'Sobre o Trymon OS', icon: <Info size={14} />, onClick: () => alert('Trymon OS v1.0.0\nRunning on WASM/Rust Kernel') },
  ];

  return (
    <>
      {!booted && <BootScreen onComplete={() => setBooted(true)} />}
      <div 
        className="os-desktop" 
        ref={desktopRef} 
        style={{ background: wallpaper, display: booted ? 'block' : 'none' }}
        onContextMenu={(e) => handleContextMenu(e, desktopContextMenu)}
        onMouseDown={handleDesktopMouseDown}
        onClick={() => setContextMenu(null)}
      >
      {/* Selection Box */}
      {selection && selection.active && (
        <div 
          className="selection-box"
          style={{
            left: Math.min(selection.startX, selection.endX),
            top: Math.min(selection.startY, selection.endY),
            width: Math.abs(selection.startX - selection.endX),
            height: Math.abs(selection.startY - selection.endY)
          }}
        />
      )}

      {/* Desktop Icons */}
      <div className="desktop-icons">
        {icons.map(icon => (
          <div 
            key={icon.id} 
            className={`desktop-icon ${draggingIconId === icon.id ? 'dragging' : ''}`}
            style={{ 
              left: `${icon.x}px`, 
              top: `${icon.y}px` 
            }}
            onClick={() => {
              if (iconDraggedRef.current) return;
              icon.onClick();
            }}
            onMouseDown={(e) => handleIconMouseDown(e, icon.id)}
            onContextMenu={(e) => handleContextMenu(e, [
              { label: `Abrir ${icon.label}`, icon: icon.icon, onClick: icon.onClick },
              { separator: true },
              { label: 'Fixar na Barra de Tarefas', icon: <Plus size={14} />, onClick: () => console.log('Pinning') },
              { label: 'Excluir Atalho', icon: <X size={14} />, danger: true, onClick: () => console.log('Delete shortcut') }
            ])}
          >
            <div className="icon-image">{icon.icon}</div>
            <div className="icon-label">{icon.label}</div>
          </div>
        ))}
      </div>

      {/* Windows */}
      {windows.filter(w => !w.isMinimized).map(window => (
        <div
          key={window.id}
          className={`window ${window.isMaximized ? 'maximized' : ''} ${draggingWindow === window.id ? 'dragging' : ''}`}
          style={{
            left: window.isMaximized ? 0 : window.position.x,
            top: window.isMaximized ? 0 : window.position.y,
            width: window.isMaximized ? '100%' : window.size.width,
            height: window.isMaximized ? 'calc(100% - 48px)' : window.size.height,
            zIndex: window.zIndex
          }}
          onMouseDown={() => bringToFront(window.id)}
        >
          {/* Window Header - Draggable */}
          <div 
            className="window-header"
            onMouseDown={(e) => handleDragStart(e, window.id)}
            onContextMenu={(e) => handleContextMenu(e, [
              { label: 'Minimizar', icon: <Minus size={14} />, onClick: () => minimizeWindow(window.id) },
              { label: window.isMaximized ? 'Restaurar' : 'Maximizar', icon: window.isMaximized ? <Square size={14} /> : <Maximize2 size={14} />, onClick: () => toggleMaximize(window.id) },
              { separator: true },
              { label: 'Fechar', icon: <X size={14} />, danger: true, onClick: () => closeWindow(window.id) }
            ])}
          >
            <div className="window-title">
              {window.icon}
              <span>{window.title}</span>
            </div>
            <div className="window-controls" onClick={(e) => e.stopPropagation()}>
              <button className="control minimize" onClick={() => minimizeWindow(window.id)} title="Minimizar">
                <Minus size={12} />
              </button>
              <button className="control maximize" onClick={() => toggleMaximize(window.id)} title={window.isMaximized ? "Restaurar" : "Maximizar"}>
                {window.isMaximized ? <Square size={10} /> : <Maximize2 size={10} />}
              </button>
              <button className="control close" onClick={() => closeWindow(window.id)} title="Fechar">
                <X size={12} />
              </button>
            </div>
          </div>
          
          <div className="window-content">
            {window.content}
          </div>

          {/* Resize Handles */}
          {!window.isMaximized && window.resizable && (
            <>
              <div className="resize-handle resize-e" onMouseDown={(e) => handleResizeStart(e, window.id, 'e')} />
              <div className="resize-handle resize-w" onMouseDown={(e) => handleResizeStart(e, window.id, 'w')} />
              <div className="resize-handle resize-s" onMouseDown={(e) => handleResizeStart(e, window.id, 's')} />
              <div className="resize-handle resize-n" onMouseDown={(e) => handleResizeStart(e, window.id, 'n')} />
              <div className="resize-handle resize-se" onMouseDown={(e) => handleResizeStart(e, window.id, 'se')} />
              <div className="resize-handle resize-sw" onMouseDown={(e) => handleResizeStart(e, window.id, 'sw')} />
              <div className="resize-handle resize-ne" onMouseDown={(e) => handleResizeStart(e, window.id, 'ne')} />
              <div className="resize-handle resize-nw" onMouseDown={(e) => handleResizeStart(e, window.id, 'nw')} />
            </>
          )}
        </div>
      ))}

      {/* Taskbar */}
      <div className="taskbar">
        <button 
          className={`start-button ${startMenuOpen ? 'active' : ''}`} 
          onClick={() => setStartMenuOpen(!startMenuOpen)}
        >
          <div className="start-icon">
            <TrymonLogo size={24} glow={false} />
          </div>
          <span>Iniciar</span>
        </button>

        <div className="taskbar-apps">
          {windows.map(w => (
            <button
              key={w.id}
              className={`taskbar-app ${activeWindowId === w.id ? 'active' : ''} ${w.isMinimized ? 'minimized' : ''}`}
              onClick={() => w.isMinimized ? minimizeWindow(w.id) : bringToFront(w.id)}
              onContextMenu={(e) => handleContextMenu(e, [
                { label: w.isMinimized ? 'Restaurar' : 'Minimizar', icon: w.isMinimized ? <Maximize2 size={14} /> : <Minus size={14} />, onClick: () => minimizeWindow(w.id) },
                { label: w.isMaximized ? 'Restaurar Tamanho' : 'Maximizar', icon: <Square size={14} />, onClick: () => toggleMaximize(w.id) },
                { separator: true },
                { label: 'Fechar Janela', icon: <X size={14} />, danger: true, onClick: () => closeWindow(w.id) }
              ])}
              title={w.title}
            >
              {w.icon}
              <span className="app-label">{w.title}</span>
            </button>
          ))}
        </div>

        <div className="system-tray">
          <div className="tray-item" title={emulatorState.isRunning ? "Emulador em execução" : "Emulador parado"}>
            {emulatorState.isRunning ? <Activity size={14} className="running" /> : <Activity size={14} />}
          </div>
          <div className="clock">
            {clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Start Menu */}
      {startMenuOpen && (
        <div className="start-menu-premium">
          <div className="start-menu-side">
            <div className="user-profile">
              <div className="user-avatar">
                <User size={20} />
              </div>
              <div className="user-info">
                <span className="user-name">Root User</span>
                <span className="user-status">Online</span>
              </div>
            </div>
            
            <div className="side-actions">
              <button className="side-btn" onClick={() => openWindow('settings', 'Configurações', <Settings size={16} />, <SettingsWindow />)} title="Configurações">
                <Settings size={18} />
              </button>
              <button className="side-btn" onClick={() => openWindow('files', 'Pastas', <FolderOpen size={16} />, <FilesWindow files={files} onUpload={handleUpload} onDelete={handleDelete} onContextMenu={handleContextMenu} />)} title="Arquivos">
                <FolderOpen size={18} />
              </button>
              <div className="spacer" />
              <button className="side-btn power-btn" onClick={() => setStartMenuOpen(false)}>
                <Power size={18} />
              </button>
            </div>
          </div>

          <div className="start-menu-main">
            <div className="search-container">
              <Search size={16} className="search-icon" />
              <input 
                type="text" 
                placeholder="Pesquisar aplicativos e documentos..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div className="start-sections">
              <div className="section">
                <h3>Fixados</h3>
                <div className="apps-grid">
                  {icons.filter((i: DesktopIcon) => i.label.toLowerCase().includes(searchQuery.toLowerCase())).map((icon: DesktopIcon) => (
                    <div key={icon.id} className="app-item" onClick={() => { icon.onClick(); setStartMenuOpen(false); }}>
                      <div className="app-icon">{icon.icon}</div>
                      <span className="app-label">{icon.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {installedApps.length > 0 && (
                <div className="section">
                  <h3>Aplicativos Trymon</h3>
                  <div className="apps-list">
                    {installedApps.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase())).map(app => (
                      <div key={app.id} className="app-list-item" onClick={async () => { await runApp(app.id); setStartMenuOpen(false); }}>
                        <div className="app-list-icon">
                          <TrymonLogo size={20} glow={false} />
                        </div>
                        <div className="app-list-info">
                          <span className="name">{app.name}</span>
                          <span className="version">v{app.version}</span>
                        </div>
                        <ChevronRight size={14} className="arrow" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="start-footer">
              <div className="power-option" onClick={emulatorState.isRunning ? handleStopEmulator : handleStartEmulator}>
                <div className={`status-dot ${emulatorState.isRunning ? 'running' : ''}`} />
                <span>{emulatorState.isRunning ? 'Desligar Trymon AI Engine' : 'Ligar Trymon AI Engine'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close start menu */}
      {startMenuOpen && (
        <div className="start-menu-overlay" onClick={() => setStartMenuOpen(false)} />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
    </>
  );
}

// ============================================
// Window Components
// ============================================

function TerminalWindow({ shell }: { shell: any }) {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<string[]>([
    '\x1b[1;36mTRYMON Shell v1.0.0\x1b[0m ready.',
    'Type "help" for available commands.',
    '',
    '\x1b[1;32mroot@trymon:~#\x1b[0m '
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    setOutput(prev => [...prev, `\x1b[1;32mroot@trymon:~#\x1b[0m ${cmd}`]);
    setHistory(prev => [cmd, ...prev]);
    setHistoryIndex(-1);
    setInput('');

    if (cmd === '') {
      setOutput(prev => [...prev, '\x1b[1;32mroot@trymon:~#\x1b[0m ']);
      return;
    }

    if (shell?.isReady && shell.execute) {
      const result = await shell.execute(cmd);
      setOutput(prev => [...prev, result, '\x1b[1;32mroot@trymon:~#\x1b[0m ']);
    } else {
      setOutput(prev => [...prev, `\x1b[1;31mbash: ${cmd}: command not found\x1b[0m`, '\x1b[1;32mroot@trymon:~#\x1b[0m ']);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(history[newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  return (
    <div className="terminal-window">
      <div className="terminal-tabs">
        <div className="terminal-tab active">
          <Terminal size={14} />
          <span>bash</span>
          <button className="tab-close"><X size={10} /></button>
        </div>
        <button className="terminal-tab-add"><Plus size={14} /></button>
      </div>
      <div className="terminal-output" ref={outputRef}>
        {output.map((line, i) => (
          <div key={i} className="terminal-line" dangerouslySetInnerHTML={{ __html: line }} />
        ))}
      </div>
      <form onSubmit={handleSubmit} className="terminal-input-line">
        <span className="prompt">root@trymon:~# </span>
        <input 
          type="text" 
          value={input} 
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus 
        />
      </form>
    </div>
  );
}

function FilesWindow({ files, onUpload, onDelete, onContextMenu }: { files: BinaryFile[], onUpload: (f: File) => void, onDelete: (id: string) => void, onContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void }) {
  const [currentPath, setCurrentPath] = useState('/');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  return (
    <div className="files-window">
      <div className="files-toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" title="Voltar">←</button>
          <button className="toolbar-btn" title="Avançar">→</button>
          <button className="toolbar-btn" title="Atualizar">↻</button>
          <button className="toolbar-btn" title="Home"><FolderOpen size={14} /></button>
        </div>
        <div className="toolbar-center">
          <input type="text" className="path-input" value={currentPath} onChange={(e) => setCurrentPath(e.target.value)} />
        </div>
        <div className="toolbar-right">
          <button className={`toolbar-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title="Grade">▦</button>
          <button className={`toolbar-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} title="Lista">≡</button>
        </div>
      </div>
      <div className="files-sidebar">
        <div className="sidebar-section">
          <h4>Locais</h4>
          <ul>
            <li className="active"><FolderOpen size={14} /> Arquivos</li>
            <li><FileCode size={14} /> Downloads</li>
            <li><FolderOpen size={14} /> Documentos</li>
          </ul>
        </div>
      </div>
      <div className="files-content">
        <input type="file" className="file-upload-input" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        <div className="files-breadcrumb">
          <span>Arquivos</span> / <span>Raiz</span>
        </div>
        <div className={`files-${viewMode}`}>
          {files.length === 0 ? (
            <div className="empty-message">
              <FolderOpen size={48} />
              <p>Nenhum arquivo</p>
              <p className="hint">Arraste arquivos aqui ou use o botão acima</p>
            </div>
          ) : (
            files.map(f => (
              <div 
                key={f.id} 
                className="file-item"
                onContextMenu={(e) => onContextMenu(e, [
                  { label: 'Abrir', icon: <FolderOpen size={14} />, onClick: () => console.log('Open file') },
                  { label: 'Baixar', icon: <Plus size={14} />, onClick: () => console.log('Download file') },
                  { separator: true },
                  { label: 'Renomear', icon: <FileCode size={14} />, onClick: () => console.log('Rename file') },
                  { label: 'Excluir', icon: <X size={14} />, danger: true, onClick: () => onDelete(f.id) }
                ])}
              >
                <FileCode size={32} />
                <span className="file-name">{f.name}</span>
                <span className="file-size">{(f.size / 1024).toFixed(1)} KB</span>
                <button className="file-delete" onClick={() => onDelete(f.id)}><X size={14} /></button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BinariesWindow({ files, onUpload, onDelete, onExecute, onContextMenu }: { files: BinaryFile[], onUpload: (f: File) => void, onDelete: (id: string) => void, onExecute: (f: BinaryFile) => void, onContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void }) {
  const [activeTab, setActiveTab] = useState<'all' | 'appimage' | 'deb' | 'rpm'>('all');

  const filteredFiles = activeTab === 'all' ? files : files.filter(f => f.type === activeTab);

  return (
    <div className="binaries-window">
      <div className="binaries-toolbar">
        <div className="binaries-tabs">
          <button className={`tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>Todos</button>
          <button className={`tab ${activeTab === 'appimage' ? 'active' : ''}`} onClick={() => setActiveTab('appimage')}>AppImage</button>
          <button className={`tab ${activeTab === 'deb' ? 'active' : ''}`} onClick={() => setActiveTab('deb')}>DEB</button>
          <button className={`tab ${activeTab === 'rpm' ? 'active' : ''}`} onClick={() => setActiveTab('rpm')}>RPM</button>
        </div>
        <div className="toolbar-right">
          <label className="upload-btn">
            <Plus size={14} />
            <span>Adicionar</span>
            <input type="file" accept=".appimage,.deb,.rpm,.elf" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </label>
        </div>
      </div>
      <div className="binaries-table-container">
        <table className="binaries-table">
          <thead>
            <tr>
              <th><input type="checkbox" /></th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Tamanho</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredFiles.length === 0 ? (
              <tr><td colSpan={6} className="empty-row">Nenhum binário carregado</td></tr>
            ) : (
              filteredFiles.map(f => (
                <tr 
                  key={f.id}
                  onContextMenu={(e) => onContextMenu(e, [
                    { label: 'Executar Binário', icon: <Terminal size={14} />, onClick: () => onExecute(f) },
                    { label: 'Configurar Execução', icon: <Settings size={14} />, onClick: () => console.log('Config') },
                    { separator: true },
                    { label: 'Excluir', icon: <X size={14} />, danger: true, onClick: () => onDelete(f.id) }
                  ])}
                >
                  <td><input type="checkbox" /></td>
                  <td className="file-name-cell">
                    <FileCode size={16} />
                    <span>{f.name}</span>
                  </td>
                  <td><span className={`type-badge ${f.type}`}>{f.type.toUpperCase()}</span></td>
                  <td>{(f.size / 1024).toFixed(1)} KB</td>
                  <td><span className={`status-badge ${f.status}`}>{f.status}</span></td>
                  <td className="actions-cell">
                    <button className="action-btn execute" onClick={() => onExecute(f)}>▶ Executar</button>
                    <button className="action-btn delete" onClick={() => onDelete(f.id)}>🗑</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsWindow() {
  const [activeSection, setActiveSection] = useState('general');

  return (
    <div className="settings-window">
      <div className="settings-sidebar">
        <button className={`settings-nav-item ${activeSection === 'general' ? 'active' : ''}`} onClick={() => setActiveSection('general')}>
          <Settings size={16} /> Geral
        </button>
        <button className={`settings-nav-item ${activeSection === 'network' ? 'active' : ''}`} onClick={() => setActiveSection('network')}>
          <Activity size={16} /> Rede
        </button>
        <button className={`settings-nav-item ${activeSection === 'security' ? 'active' : ''}`} onClick={() => setActiveSection('security')}>
          <Settings size={16} /> Segurança
        </button>
        <button className={`settings-nav-item ${activeSection === 'display' ? 'active' : ''}`} onClick={() => setActiveSection('display')}>
          <Settings size={16} /> Display
        </button>
      </div>
      <div className="settings-content">
        {activeSection === 'general' && (
          <>
            <div className="settings-section">
              <h3><Cpu size={16} /> Sistema</h3>
              <div className="setting-item">
                <label>Nome do Host</label>
                <input type="text" defaultValue="trymon" />
              </div>
              <div className="setting-item">
                <label>Memória RAM</label>
                <select defaultValue="128">
                  <option value="64">64 MB</option>
                  <option value="128">128 MB</option>
                  <option value="256">256 MB</option>
                  <option value="512">512 MB</option>
                </select>
              </div>
            </div>
            <div className="settings-section">
              <h3><Settings size={16} /> Comportamento</h3>
              <div className="setting-item toggle">
                <label>Iniciar com o sistema</label>
                <input type="checkbox" defaultChecked />
              </div>
              <div className="setting-item toggle">
                <label>Mostrar ícones na área de trabalho</label>
                <input type="checkbox" defaultChecked />
              </div>
            </div>
          </>
        )}
        {activeSection === 'network' && (
          <div className="settings-section">
            <h3><Activity size={16} /> Configurações de Rede</h3>
            <div className="setting-item toggle">
              <label>Habilitar rede</label>
              <input type="checkbox" defaultChecked />
            </div>
            <div className="setting-item">
              <label>Modo de rede</label>
              <select defaultValue="user">
                <option value="user">NAT (Compartilhado)</option>
                <option value="bridge">Ponte (Bridge)</option>
                <option value="host">Host-only</option>
              </select>
            </div>
          </div>
        )}
        {activeSection === 'security' && (
          <div className="settings-section">
            <h3><Settings size={16} /> Segurança</h3>
            <div className="setting-item toggle">
              <label>Habilitar sandbox</label>
              <input type="checkbox" defaultChecked />
            </div>
            <div className="setting-item toggle">
              <label>Bloquear acesso à rede por padrão</label>
              <input type="checkbox" />
            </div>
            <div className="setting-item toggle">
              <label>Log desystema</label>
              <input type="checkbox" defaultChecked />
            </div>
          </div>
        )}
        {activeSection === 'display' && (
          <div className="settings-section">
            <h3><Settings size={16} /> Display</h3>
            <div className="setting-item">
              <label>Resolução</label>
              <select defaultValue="1024x768">
                <option value="800x600">800 x 600</option>
                <option value="1024x768">1024 x 768</option>
                <option value="1280x720">1280 x 720</option>
                <option value="1920x1080">1920 x 1080</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MonitorWindow({ state }: { state: V86State }) {
  return (
    <div className="monitor-window">
      <div className="monitor-header">
        <h3>Recursos do Sistema</h3>
      </div>
      <div className="monitor-stats">
        <div className="stat-card">
          <div className="stat-header">
            <h4>Uso de CPU</h4>
            <span className="stat-value">{state.cpuUsage.toFixed(1)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress" style={{ width: `${Math.min(state.cpuUsage, 100)}%` }} />
          </div>
          <div className="stat-details">
            <span>4 núcleos disponíveis</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <h4>Memória</h4>
            <span className="stat-value">{state.memoryUsage.toFixed(1)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress memory" style={{ width: `${Math.min(state.memoryUsage, 100)}%` }} />
          </div>
          <div className="stat-details">
            <span>128 MB total</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <h4>Uptime</h4>
            <span className="stat-value">{Math.floor(state.uptime / 3600)}h {Math.floor((state.uptime % 3600) / 60)}m</span>
          </div>
          <div className="uptime-chart">
            <div className="uptime-bar" style={{ width: `${Math.min((state.uptime % 3600) / 36, 100)}%` }} />
          </div>
        </div>
        <div className="stat-card status-card">
          <div className="stat-header">
            <h4>Status do Sistema</h4>
          </div>
          <div className="status-indicators">
            <div className={`status-item ${state.isRunning ? 'running' : 'stopped'}`}>
              <span className="status-dot" />
              <span>Emulador</span>
              <span className="status-text">{state.isRunning ? 'Executando' : 'Parado'}</span>
            </div>
            <div className="status-item running">
              <span className="status-dot" />
              <span>Kernel</span>
              <span className="status-text">Online</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}