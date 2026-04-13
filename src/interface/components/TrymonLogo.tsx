import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
  glow?: boolean;
}

const TrymonLogo: React.FC<LogoProps> = ({ size = 32, className = '', glow = true }) => {
  return (
    <div 
      className={`trymon-logo-container ${className}`} 
      style={{ 
        width: size, 
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}
    >
      {glow && (
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          background: 'radial-gradient(circle, rgba(0, 242, 255, 0.4) 0%, rgba(0, 112, 243, 0) 70%)',
          filter: 'blur(8px)',
          zIndex: 0
        }} />
      )}
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 100 100" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: 'relative', zIndex: 1 }}
      >
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f2ff" />
            <stop offset="100%" stopColor="#0070f3" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        
        {/* Main Hexagon Frame */}
        <path 
          d="M50 5 L90 28 V72 L50 95 L10 72 V28 L50 5Z" 
          stroke="url(#logoGradient)" 
          strokeWidth="4" 
          strokeLinejoin="round"
          filter="url(#glow)"
        />
        
        {/* Core "T" shape integrated into a chip design */}
        <path 
          d="M30 35 H70 V45 H55 V75 H45 V45 H30 V35Z" 
          fill="url(#logoGradient)" 
        />
        
        {/* Tech accents / Circuit lines */}
        <rect x="25" y="28" width="6" height="2" fill="#00f2ff" opacity="0.8" />
        <rect x="69" y="28" width="6" height="2" fill="#00f2ff" opacity="0.8" />
        <rect x="25" y="70" width="6" height="2" fill="#0070f3" opacity="0.8" />
        <rect x="69" y="70" width="6" height="2" fill="#0070f3" opacity="0.8" />
        
        {/* Central Pulse Point */}
        <circle cx="50" cy="53" r="3" fill="#ffffff" />
      </svg>
    </div>
  );
};

export default TrymonLogo;
