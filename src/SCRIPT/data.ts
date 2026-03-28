

export interface GameMetadata {
  id: string;
  title: string;
  href: string;
  color: string; // Color for the 3D cartridge
}

export const GAMES: GameMetadata[] = [
  {
    id: 'snake',
    title: 'Snake',
    href: '/src/GAMES/snake/snake.html',
    color: '#00cc66'
  },
  {
    id: 'pong',
    title: 'Pong',
    href: '/src/GAMES/pong/pong.html',
    color: '#00cccc'
  },
  {
    id: 'tetris',
    title: 'Tetris',
    href: '/src/GAMES/tetris/tetris.html',
    color: '#cc00cc'
  },
  {
    id: 'quiz',
    title: 'Quiz Deluxe 3D',
    href: '/src/GAMES/super-quiz-runner/superquizrunner.html',
    color: '#cccc00'
  }
];
