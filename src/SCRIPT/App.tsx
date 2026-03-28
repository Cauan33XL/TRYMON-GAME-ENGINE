import { useState } from 'react';
import HomeView from './views/HomeView';
import SelectionView from './views/SelectionView';
import GamesView from './views/GamesView';

export type CurrentView = 'home' | 'selection' | 'games';

export default function App() {
  const [currentView, setCurrentView] = useState<CurrentView>('home');

  const handleStart = () => {
    setCurrentView('selection');
  };

  const handleSelectAction = (action: 'engine' | 'games') => {
    if (action === 'games') {
      setCurrentView('games');
    } else {
      alert('Acesso a Engine: Funcionalidade em desenvolvimento.');
    }
  };

  const handleBackToSelection = () => {
    setCurrentView('selection');
  };

  return (
    <>
      {currentView === 'home' && <HomeView onStart={handleStart} />}
      {currentView === 'selection' && <SelectionView onSelectAction={handleSelectAction} />}
      {currentView === 'games' && <GamesView onBack={handleBackToSelection} />}
    </>
  );
}
