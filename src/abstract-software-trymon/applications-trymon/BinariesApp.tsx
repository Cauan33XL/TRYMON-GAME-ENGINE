import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload, Play, Package, Trash2, ChevronRight,
  CheckCircle2, XCircle, Loader2, Download,
  Terminal, Cpu, HardDrive, FileCode,
  Zap, Info, FileText, Save
} from 'lucide-react';
import { useKernelBinaries } from '../../interface/hooks/useKernelState';
import type { BinaryInfo, TvmExecutionResult } from '../../interface/services/kernelService';
import * as kernel from '../../interface/services/kernelService';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
type CompileState = 'idle' | 'loading' | 'compiling' | 'ready' | 'error';

interface BinaryEntry extends BinaryInfo {
  packageId?: string;         // TVM package ID after compilation
  compileState: CompileState;
  compileError?: string;
  compiledFormat?: string;
}

interface ExecutionOutput {
  binaryId: string;
  result: TvmExecutionResult;
  timestamp: number;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getFormatColor(format: string): string {
  const map: Record<string, string> = {
    'ELF': '#f97316',
    'Trymon': '#00f2ff',
    'ELF→Trymon': '#a78bfa',
    'Unknown→Trymon': '#6b7280',
    'deb': '#22c55e',
    'rpm': '#ef4444',
    'AppImage': '#f59e0b',
  };
  return map[format] || '#6b7280';
}

function getFormatIcon(format: string) {
  if (format.includes('Trymon')) return <Package size={13} />;
  if (format === 'ELF') return <Cpu size={13} />;
  if (format === 'deb' || format === 'rpm') return <Download size={13} />;
  return <FileCode size={13} />;
}

// ──────────────────────────────────────────────────────────────
// Pipeline Step Badge
// ──────────────────────────────────────────────────────────────
function PipelineStep({ label, active, done, error }: {
  label: string; active: boolean; done: boolean; error: boolean;
}) {
  return (
    <div className={`bin-pipe-step ${active ? 'active' : ''} ${done ? 'done' : ''} ${error ? 'error' : ''}`}>
      <div className="bin-pipe-dot">
        {done && !error && <CheckCircle2 size={12} />}
        {error && <XCircle size={12} />}
        {active && !done && !error && <Loader2 size={12} className="spin" />}
      </div>
      <span>{label}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────
export default function BinariesApp({
  onDelete,
  onContextMenu,
}: {
  onDelete: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, items: any[]) => void;
  onUpload?: (f: File) => void;
  onExecute?: (f: BinaryInfo) => void;
  onInstall?: (f: BinaryInfo) => void;
}) {
  const { binaries } = useKernelBinaries();

  const [entries, setEntries] = useState<BinaryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [executionOutput, setExecutionOutput] = useState<ExecutionOutput | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'installed'>('all');
  const [installSuccess, setInstallSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync kernel binaries → entries (adding compile state if not present)
  useEffect(() => {
    const binaryList: BinaryInfo[] = Array.isArray(binaries) ? binaries : [];
    setEntries(prev => {
      const existing = new Map(prev.map(e => [e.id, e]));
      const next: BinaryEntry[] = binaryList.map(b => {
        const e = existing.get(b.id);
        if (e) return { ...e, ...b }; // preserve packageId / compileState
        // New entry — detect if already .trymon so it goes straight to 'ready'
        const isTrymon = b.format === 'Trymon';
        return { ...b, compileState: isTrymon ? 'ready' : 'idle' };
      });
      return next;
    });
  }, [binaries]);


  const selectedEntry = entries.find(e => e.id === selected) ?? null;

  // ── Upload ──
  const processFile = useCallback(async (file: File) => {
    console.log(`[BinariesApp] Processing file: ${file.name}`);

    // 1. Load into kernel binary loader
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      console.log(`[BinariesApp] Loading binary into kernel: ${file.name} (${data.length} bytes)`);

      const info = kernel.loadBinary(file.name, data);
      console.log(`[BinariesApp] Binary loaded with ID: ${info.id}, format: ${info.format}`);

      // 2. Add entry with 'loading' state
      const newEntry: BinaryEntry = { ...info, compileState: 'loading' };
      setEntries(prev => [...prev.filter(e => e.id !== info.id), newEntry]);

      // 3. Compile to TVM
      try {
        console.log(`[BinariesApp] Starting compilation to TVM...`);
        setEntries(prev => prev.map(e => e.id === info.id ? { ...e, compileState: 'compiling' } : e));

        const { packageId, format } = await kernel.compileBinaryToTrymon(file);

        console.log(`[BinariesApp] Compilation successful: ${format} -> ${packageId}`);
        setEntries(prev => prev.map(e =>
          e.id === info.id
            ? { ...e, compileState: 'ready', packageId, compiledFormat: format, format: format.includes('→') ? 'Trymon' : e.format }
            : e
        ));
      } catch (err: any) {
        const errorMessage = err.message || String(err);
        console.error(`[BinariesApp] Compilation failed:`, errorMessage);
        console.error(`[BinariesApp] Full error:`, err);

        setEntries(prev => prev.map(e =>
          e.id === info.id
            ? { ...e, compileState: 'error', compileError: errorMessage }
            : e
        ));
      }

      // 4. Auto-save
      setTimeout(() => kernel.saveVFSState(), 500);
    } catch (err: any) {
      const errorMessage = err.message || String(err);
      console.error(`[BinariesApp] Failed to load binary:`, errorMessage);
      console.error(`[BinariesApp] Full error:`, err);

      // Create a temporary entry to show the error
      const tempId = `error_${Date.now()}`;
      const tempEntry: BinaryEntry = {
        id: tempId,
        name: file.name,
        format: 'Unknown',
        size: file.size,
        entry_point: null,
        extracted_files: [],
        status: 'Ready',
        metadata: null,
        compileState: 'error',
        compileError: `Failed to load: ${errorMessage}`,
      };
      setEntries(prev => [...prev, tempEntry]);
    }
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(processFile);
    e.target.value = '';
  }, [processFile]);

  // Drag & Drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(processFile);
  }, [processFile]);

  // ── Execute ──
  const handleExecute = useCallback((entry: BinaryEntry) => {
    if (!entry.packageId) return;
    try {
      const result = kernel.executeTvmPackage(entry.packageId);
      setExecutionOutput({ binaryId: entry.id, result, timestamp: Date.now() });
      setSelected(entry.id);
    } catch (e: any) {
      setExecutionOutput({
        binaryId: entry.id,
        result: { success: false, exit_code: -1, stdout: '', stderr: '', error: String(e) },
        timestamp: Date.now(),
      });
    }
  }, []);

  // ── Install ──
  const handleInstall = useCallback((entry: BinaryEntry) => {
    if (!entry.packageId) return;
    const appInfo = kernel.installTvmPackage(entry.packageId, entry.name);
    if (appInfo) {
      setInstallSuccess(`"${entry.name}" instalado com sucesso!`);
      setTimeout(() => setInstallSuccess(null), 3000);
      kernel.saveVFSState();
    }
  }, []);

  // ── Download .trymon ──
  const handleDownload = useCallback((entry: BinaryEntry) => {
    if (!entry.packageId) return;
    const success = kernel.downloadTvmPackage(entry.packageId, entry.name);
    if (success) {
      setInstallSuccess(`"${entry.name}.trymon" baixado com sucesso!`);
      setTimeout(() => setInstallSuccess(null), 3000);
    }
  }, []);

  // ── Delete ──
  const handleDelete = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    if (selected === id) setSelected(null);
    onDelete(id);
  }, [onDelete, selected]);

  // ── Filter ──
  const filtered = entries.filter(e => {
    if (activeTab === 'ready') return e.compileState === 'ready';
    return true;
  });

  return (
    <div className="binaries-root">
      {/* ── Top Bar ── */}
      <div className="binaries-topbar">
        <div className="bin-tabs">
          {[['all', 'Todos'], ['ready', '✦ Prontos']].map(([v, l]) => (
            <button
              key={v}
              className={`bin-tab ${activeTab === v ? 'active' : ''}`}
              onClick={() => setActiveTab(v as any)}
            >
              {l}
              {v === 'ready' && (
                <span className="bin-tab-badge">{entries.filter(e => e.compileState === 'ready').length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="bin-topbar-right">
          <span className="bin-count">{entries.length} binário{entries.length !== 1 ? 's' : ''}</span>
          <button className="bin-upload-btn" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} />
            <span>Adicionar</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".elf,.appimage,.deb,.rpm,.trymon,.bin,.so,.out"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="binaries-layout">
        {/* ── Left: list ── */}
        <div className="binaries-list-col">
          {/* Drop zone (shown empty) */}
          {entries.length === 0 && (
            <div
              className={`bin-dropzone ${draggingOver ? 'over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
              onDragLeave={() => setDraggingOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="bin-drop-icon">
                <Upload size={32} />
              </div>
              <p className="bin-drop-title">Arraste binários aqui</p>
              <p className="bin-drop-sub">.elf · .deb · .rpm · .appimage · .trymon</p>
              <div className="bin-drop-hint">ou clique para selecionar</div>
            </div>
          )}

          {/* Drop overlay when has entries */}
          {entries.length > 0 && (
            <div
              style={{ position: 'relative' }}
              onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
              onDragLeave={() => setDraggingOver(false)}
              onDrop={handleDrop}
            >
              {draggingOver && (
                <div className="bin-drop-overlay">
                  <Upload size={28} />
                  <span>Soltar para carregar</span>
                </div>
              )}

              {/* Cards list */}
              {filtered.map(entry => (
                <div
                  key={entry.id}
                  className={`bin-card ${selected === entry.id ? 'selected' : ''} ${entry.compileState}`}
                  onClick={() => setSelected(entry.id)}
                  onContextMenu={onContextMenu ? (e) => onContextMenu(e, [
                    ...(entry.compileState === 'ready' && entry.packageId ? [
                      { label: 'Executar', icon: <Play size={14} />, onClick: () => handleExecute(entry) },
                      { label: 'Instalar no OS', icon: <Package size={14} />, onClick: () => handleInstall(entry) },
                      { label: 'Baixar .trymon', icon: <Save size={14} />, onClick: () => handleDownload(entry) },
                    ] : []),
                    { label: 'Excluir', icon: <Trash2 size={14} />, danger: true, onClick: () => handleDelete(entry.id) },
                  ]) : undefined}
                >
                  {/* Left: icon */}
                  <div className="bin-card-icon">
                    {getFormatIcon(entry.compiledFormat ?? entry.format)}
                  </div>

                  {/* Center: info */}
                  <div className="bin-card-body">
                    <div className="bin-card-name">{entry.name}</div>
                    <div className="bin-card-meta">
                      <span className="bin-format-badge" style={{ '--fc': getFormatColor(entry.compiledFormat ?? entry.format) } as any}>
                        {entry.compiledFormat ?? entry.format}
                      </span>
                      <span className="bin-size">{formatBytes(entry.size)}</span>
                    </div>
                    {/* Pipeline */}
                    <div className="bin-pipeline">
                      <PipelineStep
                        label="Upload"
                        active={entry.compileState === 'loading'}
                        done={entry.compileState !== 'idle' && entry.compileState !== 'loading'}
                        error={false}
                      />
                      <div className="bin-pipe-line" />
                      <PipelineStep
                        label="Compilar"
                        active={entry.compileState === 'compiling'}
                        done={entry.compileState === 'ready' || entry.compileState === 'error'}
                        error={entry.compileState === 'error'}
                      />
                      <div className="bin-pipe-line" />
                      <PipelineStep
                        label="TVM Pronto"
                        active={false}
                        done={entry.compileState === 'ready'}
                        error={entry.compileState === 'error'}
                      />
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="bin-card-actions">
                    {entry.compileState === 'ready' && entry.packageId && (
                      <>
                        <button
                          className="bin-action-btn execute"
                          title="Executar no TVM"
                          onClick={(e) => { e.stopPropagation(); handleExecute(entry); }}
                        >
                          <Play size={13} />
                        </button>
                        <button
                          className="bin-action-btn install"
                          title="Instalar no OS"
                          onClick={(e) => { e.stopPropagation(); handleInstall(entry); }}
                        >
                          <Package size={13} />
                        </button>
                        <button
                          className="bin-action-btn download"
                          title="Baixar .trymon"
                          onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                        >
                          <Save size={13} />
                        </button>
                      </>
                    )}
                    {(entry.compileState === 'loading' || entry.compileState === 'compiling') && (
                      <Loader2 size={16} className="spin bin-loading-icon" />
                    )}
                    <button
                      className="bin-action-btn delete"
                      title="Excluir"
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                    >
                      <Trash2 size={13} />
                    </button>
                    <ChevronRight size={13} className="bin-chevron" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: detail panel ── */}
        <div className="binaries-detail-col">
          {selectedEntry ? (
            <div className="bin-detail">
              {/* Header */}
              <div className="bin-detail-header">
                <div className="bin-detail-icon-wrap" style={{ '--fc': getFormatColor(selectedEntry.compiledFormat ?? selectedEntry.format) } as any}>
                  {getFormatIcon(selectedEntry.compiledFormat ?? selectedEntry.format)}
                </div>
                <div>
                  <div className="bin-detail-name">{selectedEntry.name}</div>
                  <div className="bin-detail-format">
                    <span className="bin-format-badge" style={{ '--fc': getFormatColor(selectedEntry.compiledFormat ?? selectedEntry.format) } as any}>
                      {selectedEntry.compiledFormat ?? selectedEntry.format}
                    </span>
                  </div>
                </div>
              </div>

              {/* Info Grid */}
              <div className="bin-detail-grid">
                <div className="bin-detail-item">
                  <HardDrive size={13} />
                  <span>{formatBytes(selectedEntry.size)}</span>
                </div>
                <div className="bin-detail-item">
                  <Cpu size={13} />
                  <span>{selectedEntry.entry_point ?? 'N/A'}</span>
                </div>
                {selectedEntry.packageId && (
                  <div className="bin-detail-item full">
                    <Zap size={13} />
                    <span className="bin-pkg-id">ID: {selectedEntry.packageId.slice(0, 16)}…</span>
                  </div>
                )}
              </div>

              {/* Status */}
              <div className={`bin-detail-status ${selectedEntry.compileState}`}>
                {selectedEntry.compileState === 'idle' && <><Info size={14} /> Aguardando compilação</>}
                {selectedEntry.compileState === 'loading' && <><Loader2 size={14} className="spin" /> Carregando…</>}
                {selectedEntry.compileState === 'compiling' && <><Loader2 size={14} className="spin" /> Convertendo para TVM…</>}
                {selectedEntry.compileState === 'ready' && <><CheckCircle2 size={14} /> Pronto para execução</>}
                {selectedEntry.compileState === 'error' && (
                  <>
                    <XCircle size={14} />
                    <span className="bin-error-text">
                      Erro: {selectedEntry.compileError
                        ? (selectedEntry.compileError.length > 200
                          ? `${selectedEntry.compileError.slice(0, 200)}...`
                          : selectedEntry.compileError)
                        : 'Erro desconhecido'}
                    </span>
                  </>
                )}
              </div>

              {/* Action buttons */}
              {selectedEntry.compileState === 'ready' && selectedEntry.packageId && (
                <div className="bin-detail-actions">
                  <button
                    className="bin-detail-btn execute"
                    onClick={() => handleExecute(selectedEntry)}
                  >
                    <Play size={14} />
                    Executar no TVM
                  </button>
                  <button
                    className="bin-detail-btn install"
                    onClick={() => handleInstall(selectedEntry)}
                  >
                    <Package size={14} />
                    Instalar no OS
                  </button>
                  <button
                    className="bin-detail-btn download"
                    onClick={() => handleDownload(selectedEntry)}
                  >
                    <Save size={14} />
                    Baixar .trymon
                  </button>
                </div>
              )}

              {/* Execution output */}
              {executionOutput && executionOutput.binaryId === selectedEntry.id && (
                <div className="bin-output-panel">
                  <div className="bin-output-header">
                    <Terminal size={13} />
                    <span>Saída da Execução</span>
                    <span className={`bin-exit-code ${executionOutput.result.exit_code === 0 ? 'ok' : 'fail'}`}>
                      exit {executionOutput.result.exit_code}
                    </span>
                    <button className="bin-output-clear" onClick={() => setExecutionOutput(null)}>
                      <XCircle size={12} />
                    </button>
                  </div>
                  <pre className="bin-output-pre">
                    {executionOutput.result.stdout || executionOutput.result.stderr || executionOutput.result.error || '(sem saída)'}
                  </pre>
                  {executionOutput.result.stats && (
                    <div className="bin-output-stats">
                      <span>⚡ {executionOutput.result.stats.instructions_executed.toLocaleString()} instruções</span>
                      <span>📞 {executionOutput.result.stats.syscall_count} syscalls</span>
                      <span>⏱ {executionOutput.result.stats.cycles.toLocaleString()} cycles</span>
                    </div>
                  )}
                </div>
              )}

              {/* Metadata */}
              {selectedEntry.metadata && (
                <div className="bin-detail-meta">
                  <div className="bin-meta-title"><FileText size={12} /> Metadados</div>
                  {selectedEntry.metadata.description && (
                    <div className="bin-meta-row">
                      <span className="bin-meta-key">Descrição</span>
                      <span className="bin-meta-val">{selectedEntry.metadata.description}</span>
                    </div>
                  )}
                  {selectedEntry.metadata.version && (
                    <div className="bin-meta-row">
                      <span className="bin-meta-key">Versão</span>
                      <span className="bin-meta-val">{selectedEntry.metadata.version}</span>
                    </div>
                  )}
                  {selectedEntry.metadata.maintainer && (
                    <div className="bin-meta-row">
                      <span className="bin-meta-key">Autor</span>
                      <span className="bin-meta-val">{selectedEntry.metadata.maintainer}</span>
                    </div>
                  )}
                  {selectedEntry.metadata.dependencies?.length > 0 && (
                    <div className="bin-meta-row">
                      <span className="bin-meta-key">Deps</span>
                      <span className="bin-meta-val">{selectedEntry.metadata.dependencies.join(', ')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bin-detail-empty">
              <FileCode size={40} strokeWidth={1} />
              <p>Selecione um binário</p>
              <span>para ver detalhes e opções</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Install toast ── */}
      {installSuccess && (
        <div className="bin-install-toast">
          <CheckCircle2 size={15} />
          {installSuccess}
        </div>
      )}
    </div>
  );
}
