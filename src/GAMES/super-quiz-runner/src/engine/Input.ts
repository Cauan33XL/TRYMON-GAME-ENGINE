import { globals, STATES } from './Globals';
import { EventBus } from '../EventBus';

export const keys: Record<string, boolean> = {};

export const input = {
    jumpPressed: false, dashPressed: false, shootPressed: false,
    
    init(){
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    },
    
    cleanup() {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
    },

    handleKeyDown: (e: KeyboardEvent) => {
        keys[e.code] = true;
        if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') input.jumpPressed = true;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.dashPressed = true;
        if (e.code === 'KeyF') input.shootPressed = true;
        
        if(globals.gameState === STATES.QUIZ && globals.currentQuiz && globals.currentQuiz.question){
            if(e.code === 'KeyA') EventBus.emit('quiz-answer', 'A');
            if(e.code === 'KeyB') EventBus.emit('quiz-answer', 'B');
            if(e.code === 'KeyC') EventBus.emit('quiz-answer', 'C');
            if(e.code === 'KeyD') EventBus.emit('quiz-answer', 'D');
        } else if (e.code === 'Escape') {
            if (globals.gameState === STATES.RUNNING || globals.gameState === STATES.BOSS_FIGHT) {
                globals.setGameState(STATES.PAUSED);
            } else if (globals.gameState === STATES.PAUSED) {
                globals.setGameState(globals.previousState || STATES.RUNNING);
            }
        } else if (globals.gameState === STATES.GAME_OVER || globals.gameState === STATES.MENU) {
            if(e.code === 'Enter' || e.code === 'Space') EventBus.emit('action-start', null);
        } else if (globals.gameState === STATES.MISSION && e.code === 'Enter') {
            globals.setGameState(STATES.RUNNING);
        }
    },
    
    handleKeyUp: (e: KeyboardEvent) => {
        keys[e.code] = false;
        if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') input.jumpPressed = false;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.dashPressed = false;
        if (e.code === 'KeyF') input.shootPressed = false;
    },
    
    isDown(c: string){ return !!keys[c]; },
    isJumpPressed(){ return this.jumpPressed; },
    isDashPressed(){ return this.dashPressed; },
    isShootPressed(){ return this.shootPressed; }
};
