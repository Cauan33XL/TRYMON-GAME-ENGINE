import { useEffect, useRef, useState } from 'react';
import { globals, STATES } from './engine/Globals';
import { ThreeEngine } from './engine/ThreeEngine';
import { EventBus } from './EventBus';
import './vanilla.css';

export default function VanillaGame() {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<ThreeEngine | null>(null);
    const [gameState, setGameState] = useState<string>(STATES.LOADING);
    const [feedback, setFeedback] = useState<{text: string, type: string, visible: boolean}>({text: '', type: 'good', visible: false});
    const [hud, setHud] = useState<any>(null);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (!containerRef.current) return;
        
        // Simulating Loading
        const interval = setInterval(() => {
            setProgress(p => {
                if (p >= 100) {
                    clearInterval(interval);
                    globals.setGameState(STATES.MENU);
                    return 100;
                }
                return p + 20;
            });
        }, 100);

        const engine = new ThreeEngine(containerRef.current);
        engineRef.current = engine;

        const onStateChange = (state: string) => setGameState(state);
        const onFeedback = (data: any) => {
            setFeedback({text: data.text, type: data.type, visible: true});
            setTimeout(() => setFeedback(f => ({...f, visible: false})), 1200);
        };
        const onSyncHud = (data: any) => setHud(data);
        const onStartAction = () => {
            if (globals.gameState === STATES.MENU) globals.setGameState(STATES.CHAR_SELECT);
            else if (globals.gameState === STATES.GAME_OVER) { globals.setGameState(STATES.CHAR_SELECT); }
        };

        const onFileLoad = (type: string, url: string, isGLB?: boolean) => {
            (globals.customAssets as any)[type] = url;
            if (type === 'player' && isGLB) (globals.customAssets as any).isPlayer3D = true;
            else if (type === 'player') (globals.customAssets as any).isPlayer3D = false;
            setGameState(prev => prev + " ");
        };
        (window as any).handleFileLoad = onFileLoad;

        EventBus.on('state-change', onStateChange);
        EventBus.on('feedback', onFeedback);
        EventBus.on('sync-hud', onSyncHud);
        EventBus.on('action-start', onStartAction);
        
        return () => {
            engine.cleanup();
            EventBus.off('state-change'); EventBus.off('feedback'); EventBus.off('sync-hud'); EventBus.off('action-start');
        };
    }, []);

    return (
        <div className="wrap">
            <div ref={containerRef} style={{width: '100%', height: '100%'}} />
            
            <div className={`feedback ${feedback.type} ${feedback.visible ? 'show' : ''}`}>{feedback.text}</div>
            
            {/* HUD */}
            {(gameState === STATES.RUNNING || gameState === STATES.BOSS_FIGHT || gameState === STATES.QUIZ || gameState === STATES.PAUSED) && hud && (
                <div className="hud-layer">
                    <div className="hud-panel left-panel">
                        <div>Pontos: {hud.score}</div>
                    </div>
                    <div className="hud-panel right-panel">
                        <div>Vidas: {hud.lives} | Nível: {hud.level}</div>
                        <div className="health-bar-container">
                            <div className="health-bar" style={{width: `${(hud.health/hud.maxHealth)*100}%`, background: hud.health > 1 ? '#10b981':'#ef4444'}}></div>
                        </div>
                    </div>
                    
                    <div className="hud-panel coins-panel">Moedas: {hud.coins}</div>

                    <div className="ability-panel">
                        <div className="ability-box" style={{opacity: hud.special?.ready ? 1 : 0.5}}>E</div>
                        <span>HABILIDADE</span>
                    </div>

                    <div className="powerup-status">
                        {Object.keys(hud.powerups || {}).map(k => hud.powerups[k].active && (
                            <div key={k} className="powerup-item">ATIVO: {k}</div>
                        ))}
                    </div>

                    {gameState === STATES.BOSS_FIGHT && (
                        <div className="boss-health-bar">
                            <div className="boss-health-fill" style={{width: `${(hud.bossHealth/hud.bossMax)*100}%`}}></div>
                            <div className="boss-health-text">BOSS</div>
                        </div>
                    )}
                </div>
            )}

            {/* Loading Screen */}
            {gameState === STATES.LOADING && (
                <div className="loading-screen">
                    <h2>CARREGANDO QUIZ RUNNER...</h2>
                    <div className="loading-bar">
                        <div className="loading-progress" style={{width: `${progress}%`}}></div>
                    </div>
                </div>
            )}

            {/* Main Menu */}
            {gameState === STATES.MENU && (
                <div className="main-menu">
                    <h1>QUIZ RUNNER DELUXE</h1>
                    <div className="menu-options">
                        <button className="menu-btn" onClick={() => globals.setGameState(STATES.CHAR_SELECT)}>JOGAR</button>
                        <button className="menu-btn" onClick={() => globals.setGameState(STATES.SETTINGS)}>CONFIGURAÇÕES</button>
                        <button className="menu-btn" onClick={() => globals.setGameState(STATES.CREDITS)}>CRÉDITOS</button>
                    </div>
                </div>
            )}

            {/* Character & Customization Select */}
            {gameState.trim() === STATES.CHAR_SELECT && (
                <div className="custom-panel">
                    <h2 className="custom-title">PERSONAGEM & CUSTOMIZAÇÃO</h2>
                    
                    <div className="name-input-container">
                        <input 
                            type="text" 
                            className="name-input" 
                            placeholder="DIGITE $EU NOME" 
                            defaultValue={globals.playerDisplayName}
                            onChange={(e) => globals.playerDisplayName = e.target.value.toUpperCase()}
                        />
                    </div>

                    <div className="char-grid">
                        {['default','ninja','robot','mage','custom'].map(char => (
                            <div key={char} className={`char-card ${globals.selectedCharacter === char ? 'selected':''}`} onClick={() => { globals.selectedCharacter = char; setGameState(STATES.CHAR_SELECT + " "); }}>
                                <div className="icon">
                                    {(char === 'custom' && globals.customAssets.player) ? <img src={globals.customAssets.player} style={{width:'100%',height:'100%',objectFit:'contain'}} /> : <div className="char-placeholder" style={{width:30,height:30,background:char==='ninja'?'#333':char==='robot'?'#888':char==='mage'?'#8b5cf6':'#ffd54f'}} />}
                                </div>
                                <div className="name">{char === 'default' ? 'HERÓI' : char.toUpperCase()}</div>
                            </div>
                        ))}
                    </div>

                    <h3 className="custom-section-title">CUSTOMIZAR JOGO</h3>
                    
                    <div className="custom-grid">
                        <div className="custom-item">
                            <span className="custom-item-label">Jogador</span>
                            <div className="custom-item-icon">👤</div>
                            <button className="load-btn" onClick={() => { const el = document.getElementById('player-upload'); if(el) el.click(); }}>
                                {globals.customAssets.player ? 'ON' : 'CARREGAR'}
                            </button>
                            <input id="player-upload" type="file" accept="image/*,.glb,.gltf" style={{display:'none'}} onChange={(e) => {
                                const file = e.target.files?.[0]; 
                                if(file) {
                                    const isGLB = file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf');
                                    (window as any).handleFileLoad('player', URL.createObjectURL(file), isGLB);
                                }
                            }} />
                        </div>
                        <div className="custom-item">
                            <span className="custom-item-label">Música (MP3)</span>
                            <div className="custom-item-icon">🎵</div>
                            <button className="load-btn" onClick={() => { const el = document.getElementById('music-upload'); if(el) el.click(); }}>
                                {globals.customAssets.music ? 'ON' : 'CARREGAR'}
                            </button>
                            <input id="music-upload" type="file" accept="audio/*" style={{display:'none'}} onChange={(e) => {
                                const file = e.target.files?.[0]; if(file) (window as any).handleFileLoad('music', URL.createObjectURL(file));
                            }} />
                        </div>
                        <div className="custom-item">
                            <span className="custom-item-label">Fundo</span>
                            <div className="custom-item-icon">🖼️</div>
                            <button className="load-btn" onClick={() => { const el = document.getElementById('bg-upload'); if(el) el.click(); }}>
                                {globals.customAssets.background ? 'ON' : 'CARREGAR'}
                            </button>
                            <input id="bg-upload" type="file" accept="image/*" style={{display:'none'}} onChange={(e) => {
                                const file = e.target.files?.[0]; if(file) (window as any).handleFileLoad('background', URL.createObjectURL(file));
                            }} />
                        </div>
                        <div className="custom-item">
                            <span className="custom-item-label">Plataforma</span>
                            <div className="custom-item-icon">🧱</div>
                            <button className="load-btn" onClick={() => { const el = document.getElementById('platform-upload'); if(el) el.click(); }}>
                                {globals.customAssets.platform ? 'ON' : 'CARREGAR'}
                            </button>
                            <input id="platform-upload" type="file" accept="image/*" style={{display:'none'}} onChange={(e) => {
                                const file = e.target.files?.[0]; if(file) (window as any).handleFileLoad('platform', URL.createObjectURL(file));
                            }} />
                        </div>
                        <div className="custom-item">
                            <span className="custom-item-label">Inimigo</span>
                            <div className="custom-item-icon">👾</div>
                            <button className="load-btn" onClick={() => { const el = document.getElementById('enemy-upload'); if(el) el.click(); }}>
                                {globals.customAssets.enemy ? 'ON' : 'CARREGAR'}
                            </button>
                            <input id="enemy-upload" type="file" accept="image/*" style={{display:'none'}} onChange={(e) => {
                                const file = e.target.files?.[0]; if(file) (window as any).handleFileLoad('enemy', URL.createObjectURL(file));
                            }} />
                        </div>
                    </div>

                    <div className="action-btns">
                        <button className="action-btn start-btn" onClick={() => engineRef.current?.initLevel() || globals.setGameState(STATES.RUNNING)}>INICIAR JOGO</button>
                        <button className="action-btn back-btn" onClick={() => globals.setGameState(STATES.MENU)}>VOLTAR</button>
                    </div>
                </div>
            )}

            {/* Game Over */}
            {gameState === STATES.GAME_OVER && (
                <div className="game-over-screen">
                    <h1>GAME OVER</h1>
                    <button className="select-btn" onClick={() => globals.setGameState(STATES.CHAR_SELECT)}>JOGAR NOVAMENTE</button>
                    <button className="select-btn" onClick={() => globals.setGameState(STATES.MENU)} style={{marginTop:10,background:'#666'}}>MENU PRINCIPAL</button>
                </div>
            )}
            
            {/* Pause Overlay */}
            {gameState === STATES.PAUSED && (
                <div style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',background:'rgba(0,0,0,0.5)',zIndex:10,pointerEvents:'none'}} />
            )}
            
            <div className="hud top-info" style={{zIndex: 0}}>Use &larr; &rarr; ou A/D para mover, W/&uarr;/SPACE para pular, SHIFT para dash, F atirar, E habilidade</div>
        </div>
    );
}
