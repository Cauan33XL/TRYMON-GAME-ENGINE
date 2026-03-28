

interface SelectionViewProps {
  onSelectAction: (action: 'engine' | 'games') => void;
}

export default function SelectionView({ onSelectAction }: SelectionViewProps) {
  return (
    <div className="selection-container">
      <div className="crts-overlay"></div>
      <h2 className="selection-title">SELECT SYSTEM MODE</h2>
      <div className="selection-grid">
        <button className="square-btn red-glow" onClick={() => onSelectAction('engine')}>
          <div className="icon">⚙️</div>
          <span>Acesso a Engine</span>
        </button>
        <button className="square-btn red-glow" onClick={() => onSelectAction('games')}>
          <div className="icon">🎮</div>
          <span>Games</span>
        </button>
      </div>
    </div>
  );
}
