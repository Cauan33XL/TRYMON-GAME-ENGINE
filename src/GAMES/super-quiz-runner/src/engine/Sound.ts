import { globals, STATES, triggerScreenShake } from './Globals';

export const sound = {
    ctx: null as any, master: null as any, musicSource: null as any, musicPlaying: false,
    musicElement: null as HTMLAudioElement | null,
    volume: 0.5, sfxVolume: 0.8,
    init(){
        try{
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.volume;
            this.master.connect(this.ctx.destination);
            this.playMusic();
        }catch(e){
            console.warn('WebAudio não disponível', e);
        }
    },
    playTone(freq=440, dur=0.12, type='sine', vol=0.9, when=0){
        if(!this.ctx) return;
        const now = this.ctx.currentTime + when;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type as any; o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(vol * this.sfxVolume, now);
        o.connect(g); g.connect(this.master); o.start(now);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        o.stop(now + dur + 0.02);
    },
    playPositional(pos: {x: number, y: number, z: number}, freq=440, dur=0.12, type='sine', vol=0.9){
        if(!this.ctx) return;
        const now = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        const p = this.ctx.createPanner();
        
        p.panningModel = 'HRTF';
        p.distanceModel = 'inverse';
        p.positionX.setValueAtTime(pos.x, now);
        p.positionY.setValueAtTime(pos.y, now);
        p.positionZ.setValueAtTime(pos.z, now);
        
        o.type = type as any; o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(vol * this.sfxVolume, now);
        
        o.connect(g); g.connect(p); p.connect(this.master);
        o.start(now);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        o.stop(now + dur + 0.02);
    },
    playMusic() {
        if (!this.ctx || this.musicPlaying) return;
        
        if (globals.customAssets.music) {
            if (this.musicElement) {
                this.musicElement.pause();
                this.musicElement.src = globals.customAssets.music;
            } else {
                this.musicElement = new Audio(globals.customAssets.music);
                this.musicElement.loop = true;
            }
            this.musicElement.volume = this.volume;
            this.musicElement.play().catch(e => console.warn("Failed to play custom music:", e));
            this.musicPlaying = true;
            return;
        }

        this.musicPlaying = true;
        const melodies = [
            {notes: [330, 392, 494, 587], tempo: 0.3},
            {notes: [262, 330, 392, 523], tempo: 0.3},
            {notes: [294, 370, 440, 587], tempo: 0.3},
            {notes: [330, 415, 494, 659], tempo: 0.3}
        ];
        let melodyIndex = 0;
        const playMelody = () => {
            if(globals.gameState !== STATES.RUNNING && globals.gameState !== STATES.QUIZ && globals.gameState !== STATES.BOSS_FIGHT) {
                this.musicPlaying = false;
                return;
            }
            if (globals.customAssets.music) {
                this.musicPlaying = false;
                return;
            }
            const melody = melodies[melodyIndex];
            const noteDuration = melody.tempo * 0.9;
            melody.notes.forEach((note, index) => {
                setTimeout(() => { this.playTone(note, noteDuration, 'triangle', 0.3); }, index * melody.tempo * 1000);
            });
            melodyIndex = (melodyIndex + 1) % melodies.length;
            setTimeout(playMelody, melody.notes.length * melody.tempo * 1000);
        };
        playMelody();
    },
    stopMusic() {
        if (this.musicElement) {
            this.musicElement.pause();
            this.musicElement.currentTime = 0;
        }
        this.musicPlaying = false;
    },
    good(){ this.playTone(880,0.12,'sine',0.85); this.playTone(1100,0.10,'sine',0.7,0.11); },
    bad(){ this.playTone(220,0.2,'sawtooth',0.95); triggerScreenShake(); },
    jump(){ this.playTone(520,0.10,'square',0.9); },
    fall(){ this.playTone(120,0.4,'sawtooth',0.95); },
    land(){ this.playTone(300, 0.08, 'square', 0.6); },
    coin(pos?: {x:number, y:number, z:number}){ 
        if(pos) this.playPositional(pos, 659, 0.1, 'sine', 0.7);
        else { this.playTone(659, 0.1, 'sine', 0.7); this.playTone(880, 0.08, 'sine', 0.6, 0.1); }
    },
    powerup(){ this.playTone(1046, 0.2, 'sine', 0.8); },
    dash(){ this.playTone(392, 0.1, 'square', 0.8); this.playTone(523, 0.08, 'square', 0.7, 0.05); },
    enemyHit(pos?: {x:number, y:number, z:number}){ 
        if(pos) this.playPositional(pos, 110, 0.3, 'sawtooth', 0.9);
        else this.playTone(110, 0.3, 'sawtooth', 0.9);
    },
    shoot(){ this.playTone(784, 0.1, 'square', 0.7); },
    bossSpawn(){ this.playTone(98, 0.5, 'sawtooth', 0.9); this.playTone(73, 0.5, 'sawtooth', 0.8, 0.2); },
    bossDefeated(){ this.playTone(523, 0.2, 'sine', 0.8); this.playTone(659, 0.2, 'sine', 0.7, 0.1); this.playTone(784, 0.2, 'sine', 0.6, 0.2); },
    setVolume(value: number) { this.volume = value / 100; if (this.master) this.master.gain.value = this.volume; if(this.musicElement) this.musicElement.volume = this.volume; },
    setSfxVolume(value: number) { this.sfxVolume = value / 100; }
};
