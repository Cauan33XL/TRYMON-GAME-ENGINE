

interface HomeViewProps {
  onStart: () => void;
}

export default function HomeView({ onStart }: HomeViewProps) {
  return (
    <div className="home-container">
      <div className="crts-overlay"></div>
      <h1 className="home-title glitch" data-text="TRYMON GAME ENGINE">
        TRYMON GAME ENGINE
      </h1>
      <button className="start-button red-glow" onClick={onStart}>
        START SYSTEM
      </button>
      <div className="decorations">
        <span className="decor-line"></span>
        <span className="decor-text">SYSTEM V1.0 - ONLINE</span>
        <span className="decor-line"></span>
      </div>
    </div>
  );
}
