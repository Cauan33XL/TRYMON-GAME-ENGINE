import { useRef, useState, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Text, useCursor, Float, Grid, Sparkles } from "@react-three/drei";
import { useSpring, a } from "@react-spring/three";
import { useDrag } from "@use-gesture/react";
import * as THREE from "three";
import { GAMES, GameMetadata } from "../data";

interface CartridgeProps {
  game: GameMetadata;
  initialPosition: [number, number, number];
  onDock: (gameId: string) => void;
  onDragChange: (isDragging: boolean) => void;
}

const Cartridge = ({ game, initialPosition, onDock, onDragChange }: CartridgeProps) => {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  
  // Guardar a posição real de repouso atual (para não resetar para a inicial do círculo)
  const [basePosition, setBasePosition] = useState<[number, number, number]>(initialPosition);
  
  useCursor(hovered, dragging ? 'grabbing' : 'grab', 'auto');

  const { size } = useThree();

  const [{ position, rotation }, api] = useSpring(() => ({
    position: initialPosition,
    rotation: [0, 0, 0] as [number, number, number],
    config: { mass: 2.5, tension: 180, friction: 35 }
  }));

  const bind = useDrag(({ active, movement: [mx, my], offset: [ox, oy] }) => {
    // Se já estiver iniciando (docked), ignorar novos arrastes
    if (basePosition[0] === 0 && basePosition[1] === 0.6 && basePosition[2] === 0) return;

    setDragging(active);
    onDragChange(active);

    const x = basePosition[0] + (ox / size.width) * 24;
    const z = basePosition[2] + (oy / size.height) * 24;
    
    const y = active ? 3.5 : 0.5;

    if (active) {
      api.start({ 
        position: [x, y, z],
        rotation: [-Math.PI / 10, mx * 0.005, my * -0.005] 
      });
    } else {
      const currentPos = new THREE.Vector3(x, y, z);
      const dockPos = new THREE.Vector3(0, 0, 0);
      const dist = currentPos.distanceTo(dockPos);

      if (dist < 2.5) {
        // Drop Vertical dentro do Dock
        const target: [number, number, number] = [0, 0.6, 0];
        setBasePosition(target); // Fixar estado para não resetar
        api.start({ 
          position: target,
          rotation: [-Math.PI / 2, 0, 0],
          config: { mass: 3, tension: 350, friction: 15 },
          onRest: () => onDock(game.id) // Iniciar após terminar a queda
        });
      } else {
        // Cai no chão onde foi solto
        const target: [number, number, number] = [x, 0.5, z];
        setBasePosition(target);
        api.start({ 
          position: target, 
          rotation: [0, 0, 0],
          config: { mass: 2, tension: 120, friction: 12 }
        });
      }
    }
  }, { 
    from: () => [0, 0], // Resetar movimento relativo a cada novo clique
    delay: false 
  });

  return (
    <a.group
      {...(bind() as any)}
      position={position}
      rotation={rotation}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <Float speed={hovered && !dragging ? 5 : 0} rotationIntensity={0.1} floatIntensity={dragging ? 0 : 0.4}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.4, 2.2]} />
          <meshStandardMaterial 
            color={hovered ? '#440000' : '#1a0000'} 
            roughness={0.4} 
            metalness={0.9}
            emissive={hovered ? '#ff0000' : game.color}
            emissiveIntensity={hovered ? 0.5 : 0.15}
          />
        </mesh>

        {/* Linha vermelha design industrial */}
        <mesh position={[0, 0.21, 0]}>
           <planeGeometry args={[1.6, 0.1]} />
           <meshBasicMaterial color={game.color} />
        </mesh>
        
        {/* Label on cartridge */}
        <Text
          position={[0, 0.22, -0.2]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.25}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
        >
          {game.title}
        </Text>
      </Float>
    </a.group>
  );
};

const Dock = () => {
  return (
    <group position={[0, 0, 0]}>
      {/* Base maior metálica */}
      <mesh receiveShadow castShadow position={[0, 0.25, 0]}>
        <cylinderGeometry args={[3, 3.5, 0.5, 8]} />
        <meshStandardMaterial color="#222" roughness={0.7} metalness={0.8} />
      </mesh>
      
      {/* O Encaixe Central */}
      <mesh receiveShadow castShadow position={[0, 0.6, 0]}>
        <boxGeometry args={[2.0, 0.6, 2.6]} />
        <meshStandardMaterial color="#0a0000" emissive="#330000" emissiveIntensity={0.5} roughness={0.2} metalness={0.9} />
      </mesh>

      {/* Buraco do Encaixe */}
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[1.7, 0.05, 2.3]} />
        <meshBasicMaterial color="#000" />
      </mesh>

      {/* Texto Flutuante Holográfico Vermelho */}
      <Float speed={3} rotationIntensity={0} floatIntensity={0.5}>
        <Text 
          position={[0, 1.8, -2.2]} 
          fontSize={0.4} 
          color="#ff3333"
        >
          INSERT CARTRIDGE
        </Text>
      </Float>

      {/* Luz pulsante do Dock */}
      <pointLight position={[0, 1.5, 0]} color="#ff0000" intensity={2} distance={5} />
    </group>
  );
};

interface GamesViewProps {
  onBack: () => void;
}

export default function GamesView({ onBack }: GamesViewProps) {
  const [starting, setStarting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const selectSoundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    selectSoundRef.current = document.getElementById('select-sound') as HTMLAudioElement;
  }, []);

  const handleDock = (id: string) => {
    if (starting) return;
    setStarting(true);
    
    if (selectSoundRef.current) {
      selectSoundRef.current.currentTime = 0;
      selectSoundRef.current.play().catch(() => {});
    }

    const game = GAMES.find(g => g.id === id);
    if (game && game.href) {
      setTimeout(() => {
        window.location.href = game.href;
      }, 800);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#050505', position: 'relative' }}>
      
      {/* Camada CSS para Efeito CRT por cima de tudo! */}
      <div className="crts-overlay" style={{ pointerEvents: 'none', zIndex: 20 }}></div>

      <button 
        className="back-btn" 
        onClick={onBack}
        style={{
          position: 'absolute', top: 20, left: 20, zIndex: 30,
          background: 'transparent', color: '#ff3333', 
          border: '2px solid #ff3333', padding: '10px 20px',
          fontFamily: "'Press Start 2P', cursive", cursor: 'pointer',
          boxShadow: 'inset 0 0 10px #ff0000', textShadow: '0 0 5px #ff0000'
        }}
      >
        BACK
      </button>

      <div className={starting ? 'fade-out-overlay active' : 'fade-out-overlay'} style={{ zIndex: 40, background: '#1a0000' }}></div>

      <Canvas shadows camera={{ position: [0, 10, 12], fov: 45 }}>
        {/* Fundo bem escuro avermelhado */}
        <color attach="background" args={['#050000']} />
        <fog attach="fog" args={['#0a0000', 10, 40]} />
        
        <ambientLight intensity={0.2} color="#ffcccc" />
        <spotLight position={[0, 15, 0]} intensity={2.5} color="#ff3333" penumbra={1} castShadow />
        
        <Dock />

        {/* Faíscas no ar para dar clima industrial */}
        <Sparkles count={100} scale={15} size={4} color="#ff3333" speed={0.4} opacity={0.5} />

        {/* Disposição Inicial dos Cartuchos */}
        {GAMES.map((game, i) => {
          const angle = (i / (GAMES.length - 1)) * Math.PI - Math.PI; 
          const radius = 6;
          const x = Math.sin(angle) * radius;
          const z = Math.cos(angle) * radius - 2;

          return (
            <Cartridge 
              key={game.id} 
              game={game} 
              initialPosition={[x, 0.5, z]} 
              onDock={handleDock}
              onDragChange={setIsDragActive}
            />
          );
        })}

        {/* Piso Industrial Refletivo com Grade */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial 
            color="#0a0000"
            roughness={0.6}
            metalness={0.8}
          />
        </mesh>
        
        {/* Grid Floor para estética Retro Neon Vermelha */}
        <Grid position={[0, 0, 0]} args={[100, 100]} cellColor="#aa0000" sectionColor="#ff0000" fadeDistance={30} fadeStrength={1} />

        {/* Controles Órbita travados para não cruzar o chão, e sem PAN para não fugir da cena */}
        <OrbitControls makeDefault enabled={!isDragActive} minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} minDistance={5} maxDistance={20} enablePan={false} />
      </Canvas>
    </div>
  );
}
