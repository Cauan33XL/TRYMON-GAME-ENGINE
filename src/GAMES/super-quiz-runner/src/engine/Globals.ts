import * as THREE from 'three';
import { EventBus } from '../EventBus';

export const CONFIG = {
    WIDTH: 900, HEIGHT: 600, GRAVITY: 0.8,
    PLAYER: { WIDTH: 44, HEIGHT: 60, ACC: 0.7, FRICTION: 0.85, MAX_SPEED: 6, JUMP_V: -16, JUMP_HOLD_GRAVITY_MULT: 0.5, COYOTE_TIME: 0.1, JUMP_BUFFER_TIME: 0.1, DASH_SPEED: 15, DASH_DURATION: 0.2, DASH_COOLDOWN: 1.5, PROJECTILE_SPEED: 10, PROJECTILE_COOLDOWN: 0.5 },
    PLATFORM: { HEIGHT: 36, MIN_W: 140, MAX_W: 300 },
    POWERUP: { DURATION: { SHIELD: 10, DOUBLE_JUMP: 15, MAGNET: 12, SPEED_BOOST: 8, INVINCIBILITY: 5, PROJECTILE: 20, TIME_SLOW: 7 } },
    PARTICLE_COLORS: { JUMP: '#ffffff', LAND: '#d1d5db', SCORE: '#ffd54f', POWERUP: '#8b5cf6', ENEMY: '#ef4444', DASH: '#60a5fa', PROJECTILE: '#fbbf24', BOSS: '#dc2626' },
    SCREEN_SHAKE_DURATION: 0.15, SCREEN_SHAKE_MAGNITUDE: 5,
    LEVELS: [ { SPEED: 1, ENEMY_SPAWN_RATE: 0.002, POWERUP_SPAWN_RATE: 0.001, PLATFORM_GAP: 120, BOSS_SPAWN: false }, { SPEED: 1.2, ENEMY_SPAWN_RATE: 0.004, POWERUP_SPAWN_RATE: 0.002, PLATFORM_GAP: 110, BOSS_SPAWN: false }, { SPEED: 1.4, ENEMY_SPAWN_RATE: 0.006, POWERUP_SPAWN_RATE: 0.003, PLATFORM_GAP: 100, BOSS_SPAWN: false }, { SPEED: 1.6, ENEMY_SPAWN_RATE: 0.008, POWERUP_SPAWN_RATE: 0.004, PLATFORM_GAP: 90, BOSS_SPAWN: false }, { SPEED: 1.8, ENEMY_SPAWN_RATE: 0.01, POWERUP_SPAWN_RATE: 0.005, PLATFORM_GAP: 80, BOSS_SPAWN: true }, { SPEED: 2.0, ENEMY_SPAWN_RATE: 0.012, POWERUP_SPAWN_RATE: 0.006, PLATFORM_GAP: 70, BOSS_SPAWN: false }, { SPEED: 2.2, ENEMY_SPAWN_RATE: 0.014, POWERUP_SPAWN_RATE: 0.007, PLATFORM_GAP: 60, BOSS_SPAWN: false }, { SPEED: 2.4, ENEMY_SPAWN_RATE: 0.016, POWERUP_SPAWN_RATE: 0.008, PLATFORM_GAP: 50, BOSS_SPAWN: true } ],
    MISSIONS: { SCORE: 500, CORRECT_QUIZZES: 5, COINS: 10, ENEMIES_DEFEATED: 5, POWERUPS_USED: 3 }
};

export const STATES = { LOADING:'LOADING', MENU:'MENU', CHAR_SELECT:'CHAR_SELECT', RUNNING:'RUNNING', QUIZ:'QUIZ', FALLING:'FALLING', GAME_OVER:'GAME_OVER', PAUSED:'PAUSED', BOSS_FIGHT:'BOSS_FIGHT', MISSION:'MISSION', SETTINGS:'SETTINGS', CREDITS:'CREDITS' };

export interface GlobalState {
    canvas: HTMLCanvasElement | null;
    ctx: CanvasRenderingContext2D | null;
    gameState: string;
    previousState: string | null;
    player: any;
    camera: any;
    platforms: any[];
    backLayers: any[];
    enemies: any[];
    powerups: any[];
    coins: any[];
    projectiles: any[];
    enemyProjectiles: any[];
    boss: any;
    particles: any[];
    screenShake: { duration: number; magnitude: number };
    score: number;
    coinCount: number;
    lives: number;
    currentLevel: number;
    gameTime: number;
    quizCount: number;
    correctAnswers: number;
    powerupsCollected: number;
    selectedCharacter: string;
    playerDisplayName: string;
    customAssets: {
        player: string | null;
        background: string | null;
        platform: string | null;
        enemy: string | null;
        music: string | null;
        isPlayer3D?: boolean;
    };
    threeScene: THREE.Scene | null;
    threeCamera: THREE.PerspectiveCamera | null;
    threeRenderer: THREE.WebGLRenderer | null;
    quizManager: any;
    quizTriggerX: number;
    currentQuiz: any;
    missionProgress: {
        score: number;
        correctQuizzes: number;
        coins: number;
        enemiesDefeated: number;
        powerupsUsed: number;
    };
    setGameState: (newState: string) => void;
}

export const globals: GlobalState = {
    canvas: null, ctx: null,
    gameState: STATES.LOADING, previousState: null,
    player: null, camera: null, platforms: [], backLayers: [], 
    enemies: [], powerups: [], coins: [], projectiles: [], enemyProjectiles: [], boss: null,
    particles: [], screenShake: {duration: 0, magnitude: 0},
    score: 0, coinCount: 0, lives: 3, currentLevel: 0, gameTime: 0, quizCount: 0, correctAnswers: 0, powerupsCollected: 0,
    selectedCharacter: 'default', 
    playerDisplayName: 'HERÓI',
    customAssets: {
        player: null,
        background: null,
        platform: null,
        enemy: null,
        music: null,
        isPlayer3D: false
    },
    threeScene: null,
    threeCamera: null,
    threeRenderer: null,
    quizManager: null, quizTriggerX: 0, currentQuiz: null,
    missionProgress: {score:0, correctQuizzes:0, coins:0, enemiesDefeated:0, powerupsUsed:0},
    
    setGameState(newState: string) {
        if(this.gameState !== newState) {
            this.previousState = this.gameState;
            this.gameState = newState;
            EventBus.emit('state-change', newState);
        }
    }
};

export function triggerScreenShake(duration = CONFIG.SCREEN_SHAKE_DURATION, magnitude = CONFIG.SCREEN_SHAKE_MAGNITUDE) {
    globals.screenShake.duration = duration;
    globals.screenShake.magnitude = magnitude;
}

export function spawnParticles(x: number, y: number, color: string, count: number, size: number = 4, gravity: boolean = true){
    for(let i=0; i<count; i++){
        globals.particles.push({
            x, y, vx:(Math.random()-0.5)*5, vy:(Math.random()*-4)-1.5,
            life:0.6 + Math.random()*0.5, color, size: size * (0.5 + Math.random() * 0.5), gravity: gravity
        });
    }
}
