import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { globals, STATES, triggerScreenShake } from './Globals';
import { sound } from './Sound';
import { EventBus } from '../EventBus';

// ─── Physics & Game Constants ─────────────────────────────────────────────────
const GRAVITY_ACC     = -30;    // acceleration (units/s²)
const JUMP_FORCE      = 14;     // initial jump velocity
const JUMP_HOLD_MULT  = 0.35;   // gravity reduction while holding jump+rising
const FAST_FALL_MULT  = 1.8;    // extra gravity on the way down
const PLAYER_SPEED    = 10;     // horizontal strafe speed
const DASH_SPEED      = 28;
const DASH_TIME       = 0.18;
const DASH_CD         = 1.8;
const WORLD_SPEED_BASE= 13;     // Z-scroll speed at level 0
const MAX_JUMPS       = 2;
const PW              = 0.55;   // player collision half-width (x)
const PH              = 1.55;   // player collision height
const SHOOT_CD        = 0.45;

// Max horizontal jump range: speed × (2 × jumpForce / |gravity|)
const MAX_REACH_Z = PLAYER_SPEED * ((2 * JUMP_FORCE) / Math.abs(GRAVITY_ACC));  // ≈ 9.3

// ─── Simple AABB ──────────────────────────────────────────────────────────────
function makePlayerBox(pos: THREE.Vector3) {
    return new THREE.Box3(
        new THREE.Vector3(pos.x - PW, pos.y - PH / 2, pos.z - 0.28),
        new THREE.Vector3(pos.x + PW, pos.y + PH / 2, pos.z + 0.28)
    );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Platform {
    mesh: THREE.Mesh;
    type: 'normal' | 'lava' | 'bounce' | 'breakable';
    topY: number;   // world Y of top surface
    halfD: number;  // half depth (z)
}

interface Enemy {
    mesh: THREE.Mesh;
    type: 'static' | 'moving';
    startX: number;
    dir: number;
}

interface Coin  { mesh: THREE.Mesh; kind: 'coin' | 'powerup'; }

interface Particle {
    mesh: THREE.Mesh;
    vx: number; vy: number; vz: number;
    life: number; maxLife: number;
}

// ─────────────────────────────────────────────────────────────────────────────
export class ThreeEngine {
    // Core
    scene!: THREE.Scene;
    camera!: THREE.PerspectiveCamera;
    renderer!: THREE.WebGLRenderer;
    rafId = 0;
    lastTime = 0;
    running = false;   // engine loop active guard

    // Player
    player!: THREE.Group;
    playerMesh!: THREE.Mesh;
    playerParts: Record<string, THREE.Object3D> = {};
    animTime = 0;

    // GLTF mixer support
    mixer?: THREE.AnimationMixer;
    playerAnimations: Record<string, THREE.AnimationAction> = {};
    currentAnim?: THREE.AnimationAction;

    // Physics state
    vel = new THREE.Vector3();
    jumpCount  = 0;
    jumpHeld   = false;
    isDashing  = false;
    dashTimer  = 0;
    dashCooldown = 0;
    invincible = 0;
    shootTimer = 0;
    keys: Record<string, boolean> = {};

    // World entities
    platforms: Platform[] = [];
    enemies: Enemy[]      = [];
    coins: Coin[]         = [];
    projectiles: THREE.Mesh[] = [];
    particles: Particle[] = [];

    // Level generator state
    genZ      = -25;    // Z position of the leading edge of generated content
    lastPlatY = 0;
    lastPlatX = 0;

    // Accumulated game distance for HUD
    distZ = 0;

    // Safety tracking
    lastSafeX = 0;
    lastSafeY = 1.0;

    // ── Colors ──
    C = {
        sky: 0x87ceeb, platform: 0x22c55e, lava: 0xef4444,
        bounce: 0x38bdf8, breakable: 0xd1d5db,
        coin: 0xfbbf24, powerup: 0x8b5cf6,
        enemy: 0xf97316, projectile: 0xfde68a,
        skin: 0xffe0bd,
        shirt: { default: 0x3b82f6, ninja: 0x1e293b, robot: 0x94a3b8, mage: 0x8b5cf6 } as Record<string, number>,
        pants: { default: 0x1e3a5f, ninja: 0x0f172a, robot: 0x334155, mage: 0x4c1d95 } as Record<string, number>,
    };

    // ─────────────────────────────────────────────────────────────────────────
    constructor(container: HTMLElement) {
        this.buildScene(container);
        this.buildLighting();
        this.player = this.createCartoonMan();
        this.scene.add(this.player);
        this.bindEvents();
        this.loop(0);  // start the render loop once
    }

    // ─── Scene / Renderer ─────────────────────────────────────────────────────
    private buildScene(container: HTMLElement) {
        this.scene    = new THREE.Scene();
        this.scene.background = new THREE.Color(this.C.sky);
        this.scene.fog = new THREE.FogExp2(this.C.sky, 0.016);

        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 400);
        this.camera.position.set(0, 7, 13);
        this.camera.lookAt(0, 1, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        this.renderer.shadowMap.enabled  = true;
        this.renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        container.appendChild(this.renderer.domElement);

        globals.threeScene    = this.scene;
        globals.threeCamera   = this.camera;
        globals.threeRenderer = this.renderer;

        const listener = new THREE.AudioListener();
        this.camera.add(listener);
        (window as any).threeAudioListener = listener;
    }

    private buildLighting() {
        this.scene.add(new THREE.AmbientLight(0xfff0e0, 0.75));

        const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
        sun.position.set(12, 28, 18);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.left  = sun.shadow.camera.bottom = -40;
        sun.shadow.camera.right = sun.shadow.camera.top    =  40;
        sun.shadow.camera.near  = 1;
        sun.shadow.camera.far   = 150;
        sun.shadow.bias = -0.0015;
        this.scene.add(sun);

        this.scene.add(new THREE.HemisphereLight(0x87ceeb, 0x44bb55, 0.45));
    }

    // ─── Cartoon Man ──────────────────────────────────────────────────────────
    createCartoonMan(char = 'default'): THREE.Group {
        const grp    = new THREE.Group();
        grp.name     = 'player';
        const shirt  = this.C.shirt[char] ?? this.C.shirt['default'];
        const pants  = this.C.pants[char] ?? this.C.pants['default'];
        const skin   = this.C.skin;

        const limb = (r: number, len: number, color: number) => {
            const pivot = new THREE.Group();
            const geo   = new THREE.CapsuleGeometry(r, len, 6, 10);
            const mesh  = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
            mesh.castShadow = true;
            mesh.position.y = -(len * 0.5 + r);
            pivot.add(mesh);
            return pivot;
        };

        // Torso (waist at y=0, top at ~0.5)
        const torsoGeo = new THREE.CapsuleGeometry(0.27, 0.44, 6, 10);
        this.playerMesh = new THREE.Mesh(torsoGeo, new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.6 }));
        this.playerMesh.castShadow = true;
        grp.add(this.playerMesh);

        this.playerParts['torso'] = this.playerMesh;

        // Head
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.235, 16, 16),
            new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 })
        );
        head.castShadow = true;
        head.position.y = 0.62;
        this.playerMesh.add(head);
        this.playerParts['head'] = head;

        // Eyes
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
        const hlMat  = new THREE.MeshBasicMaterial({ color: 0xffffff });
        [0.1, -0.1].forEach(ox => {
            const e = new THREE.Mesh(new THREE.SphereGeometry(0.043, 8, 8), eyeMat);
            e.position.set(ox, 0.05, 0.195);
            const hl = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), hlMat);
            hl.position.set(0.01, 0.018, 0.04); e.add(hl);
            head.add(e);
        });

        // Smile
        const smile = new THREE.Mesh(
            new THREE.TorusGeometry(0.065, 0.013, 6, 12, Math.PI),
            new THREE.MeshBasicMaterial({ color: 0x5c2d00 })
        );
        smile.position.set(0, -0.065, 0.21);
        smile.rotation.z = Math.PI;
        head.add(smile);

        // Hair
        const hair = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
            new THREE.MeshStandardMaterial({ color: 0x2d1600, roughness: 1 })
        );
        hair.position.set(0, 0.035, 0);
        head.add(hair);

        // Arms
        const armL = limb(0.087, 0.37, skin);
        armL.position.set(0.375, 0.19, 0);
        this.playerMesh.add(armL);
        this.playerParts['armL'] = armL;

        const armR = limb(0.087, 0.37, skin);
        armR.position.set(-0.375, 0.19, 0);
        this.playerMesh.add(armR);
        this.playerParts['armR'] = armR;

        // Legs
        const legL = limb(0.125, 0.40, pants);
        legL.position.set(0.135, -0.23, 0);
        this.playerMesh.add(legL);
        this.playerParts['legL'] = legL;

        const legR = limb(0.125, 0.40, pants);
        legR.position.set(-0.135, -0.23, 0);
        this.playerMesh.add(legR);
        this.playerParts['legR'] = legR;

        // Shoes
        const shGeo = new THREE.BoxGeometry(0.21, 0.095, 0.31);
        const shMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
        [legL, legR].forEach(leg => {
            const shoe = new THREE.Mesh(shGeo, shMat);
            const child = leg.children[0] as THREE.Mesh;
            shoe.position.set(0, child.position.y - 0.2, 0.04);
            leg.add(shoe);
        });

        return grp;
    }

    // ─── Level Init ───────────────────────────────────────────────────────────
    initLevel() {
        // Clear all entities
        this.platforms.forEach(p => this.scene.remove(p.mesh));
        this.enemies.forEach(e   => this.scene.remove(e.mesh));
        this.coins.forEach(c     => this.scene.remove(c.mesh));
        this.projectiles.forEach(p => this.scene.remove(p));
        this.particles.forEach(p => this.scene.remove(p.mesh));

        this.platforms   = [];
        this.enemies     = [];
        this.coins       = [];
        this.projectiles = [];
        this.particles   = [];

        // Reset game globals
        globals.lives        = 3;
        globals.score        = 0;
        globals.coinCount    = 0;
        globals.currentLevel = 0;

        // Reset physics
        this.vel.set(0, 0, 0);
        this.jumpCount   = 0;
        this.jumpHeld    = false;
        this.isDashing   = false;
        this.dashTimer   = 0;
        this.dashCooldown= 0;
        this.invincible  = 0;
        this.shootTimer  = 0;
        this.distZ       = 0;
        this.keys        = {};
        this.lastSafeX   = 0;
        this.lastSafeY   = 1.0;

        // Level generation seed
        this.genZ      = -25;
        this.lastPlatY = 0;
        this.lastPlatX = 0;

        // Starting platform centered at player Z=0
        this.spawnPlatform(0, 0, 0, 15, 1, 45, 'normal');

        // Player standing position: y = platform top (0.5) + PH/2
        this.player.position.set(0, 0.5 + PH / 2, 0);
        this.player.rotation.y = Math.PI;

        // Update character appearance
        this.applyCharacterColors();

        // Pre-generate segments ahead
        for (let i = 0; i < 10; i++) this.generateSegment();

        globals.setGameState(STATES.RUNNING);
        this.syncHUD();
    }

    // ─── Platform Creation ────────────────────────────────────────────────────
    private spawnPlatform(x: number, y: number, z: number,
                           w: number, h: number, d: number,
                           type: Platform['type']): Platform {
        const colorMap = {
            normal: this.C.platform, lava: this.C.lava,
            bounce: this.C.bounce, breakable: this.C.breakable,
        };
        const emissiveMap: Partial<Record<string, number>> = { lava: 0xcc1100, bounce: 0x006699 };

        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshStandardMaterial({
            color: colorMap[type] ?? this.C.platform,
            emissive: emissiveMap[type] ?? 0x000000,
            emissiveIntensity: emissiveMap[type] ? 0.3 : 0,
            roughness: type === 'bounce' ? 0.25 : 0.82,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        const plat: Platform = { mesh, type, topY: y + h / 2, halfD: d / 2 };
        this.platforms.push(plat);
        return plat;
    }

    // ─── Procedural Generator ─────────────────────────────────────────────────
    private generateSegment() {
        const level = globals.currentLevel || 0;

        // Platform size — gets narrower / longer with level
        const pW   = THREE.MathUtils.randFloat(Math.max(3, 7 - level * 0.4), Math.max(5, 10 - level * 0.5));
        const pLen = THREE.MathUtils.randFloat(9, 20);
        const pH   = 1;

        // Gap — bounded by physics
        const maxGap = Math.min(MAX_REACH_Z * 0.72, 6.5 + level * 0.25);
        const gap    = THREE.MathUtils.randFloat(1.8, maxGap);

        // Vertical drift
        const dY = THREE.MathUtils.randFloat(-1.2, 1.2);
        const newY = Math.max(-1.8, Math.min(2, this.lastPlatY + dY));

        // Horizontal drift
        const dX  = THREE.MathUtils.randFloat(-3, 3);
        const newX = Math.max(-5, Math.min(5, this.lastPlatX + dX));

        // Type ramp
        const rand = Math.random();
        const lavaCh = Math.min(0.14, 0.03 * level);
        const bncCh  = Math.min(0.13, 0.04 + 0.02 * level);
        const brkCh  = Math.min(0.18, 0.04 + 0.03 * level);
        let type: Platform['type'] = 'normal';
        if      (rand < lavaCh)                   type = 'lava';
        else if (rand < lavaCh + bncCh)           type = 'bounce';
        else if (rand < lavaCh + bncCh + brkCh)   type = 'breakable';

        this.genZ -= gap;
        const cz = this.genZ - pLen / 2;
        this.spawnPlatform(newX, newY, cz, pW, pH, pLen, type);
        this.lastPlatY = newY;
        this.lastPlatX = newX;

        const topY = newY + pH / 2;
        this.genZ -= pLen;

        // Coins
        if (Math.random() > 0.35) {
            const cnt = Math.floor(Math.random() * 5) + 2;
            for (let i = 0; i < cnt; i++) {
                const cx = newX + (Math.random() - 0.5) * pW * 0.6;
                const cz2 = cz + (Math.random() - 0.5) * pLen * 0.55;
                this.spawnCoin(cx, topY + 1.0, cz2);
            }
        }

        // Enemy
        if (Math.random() > 0.5 && type !== 'lava') {
            const eType: Enemy['type'] = Math.random() > 0.45 ? 'moving' : 'static';
            this.spawnEnemy(newX, topY + 0.5, cz, eType);
        }

        // Powerup
        if (Math.random() > 0.68) {
            this.spawnPowerup(newX, topY + 1.5, cz);
        }
    }

    // ─── Object Factories ─────────────────────────────────────────────────────
    private spawnCoin(x: number, y: number, z: number) {
        const geo = new THREE.CylinderGeometry(0.33, 0.33, 0.11, 14);
        const mat = new THREE.MeshStandardMaterial({
            color: this.C.coin, metalness: 0.9, roughness: 0.1,
            emissive: this.C.coin, emissiveIntensity: 0.12
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.rotation.x = Math.PI / 2;
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.coins.push({ mesh, kind: 'coin' });
    }

    private spawnPowerup(x: number, y: number, z: number) {
        const geo  = new THREE.TorusGeometry(0.38, 0.14, 10, 20);
        const mat  = new THREE.MeshStandardMaterial({
            color: this.C.powerup, emissive: this.C.powerup,
            emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.25
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.coins.push({ mesh, kind: 'powerup' });
    }

    private spawnEnemy(x: number, y: number, z: number, type: Enemy['type']) {
        const geo  = new THREE.SphereGeometry(0.46, 14, 14);
        const mat  = new THREE.MeshStandardMaterial({
            color: this.C.enemy, roughness: 0.55,
            emissive: 0xff2200, emissiveIntensity: 0.18
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;

        // Eyes
        const eGeo = new THREE.SphereGeometry(0.075, 8, 8);
        const eMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        [0.17, -0.17].forEach(ox => {
            const eye = new THREE.Mesh(eGeo, eMat);
            eye.position.set(ox, 0.14, 0.38);
            mesh.add(eye);
        });

        this.scene.add(mesh);
        this.enemies.push({ mesh, type, startX: x, dir: 1 });
    }

    // ─── Input ────────────────────────────────────────────────────────────────
    private bindEvents() {
        window.addEventListener('resize',  this.onResize);
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup',   this.onKeyUp);
    }

    private onResize = () => {
        const container = this.renderer.domElement.parentElement;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    };

    private onKeyDown = (e: KeyboardEvent) => {
        if (this.keys[e.code]) return;  // prevent key-repeat
        this.keys[e.code] = true;

        if (globals.gameState !== STATES.RUNNING) return;

        const isJump = e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
        if (isJump) {
            this.jumpHeld = true;
            if (this.jumpCount < MAX_JUMPS) {
                const force = this.jumpCount === 0 ? JUMP_FORCE : JUMP_FORCE * 0.8;
                this.vel.y  = force;
                this.jumpCount++;
                sound.jump();
                if (this.jumpCount === 2) {
                    this.spawnParticles(this.player.position, 0x8b5cf6, 12);
                }
            }
        }

        if (e.code === 'ShiftLeft' && this.dashCooldown <= 0) {
            this.isDashing    = true;
            this.dashTimer    = DASH_TIME;
            this.dashCooldown = DASH_CD;
            sound.dash();
        }

        if (e.code === 'KeyF') {
            this.shootProjectile();
        }
    };

    private onKeyUp = (e: KeyboardEvent) => {
        delete this.keys[e.code];
        const isJump = e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
        if (isJump) this.jumpHeld = false;
    };

    // ─── Projectile ───────────────────────────────────────────────────────────
    private shootProjectile() {
        if (this.shootTimer > 0) return;
        const geo  = new THREE.SphereGeometry(0.26, 8, 8);
        const mat  = new THREE.MeshBasicMaterial({ color: this.C.projectile });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(this.player.position);
        mesh.position.y += 0.2;
        (mesh as any)._vel = new THREE.Vector3(0, 0, -25);
        this.scene.add(mesh);
        this.projectiles.push(mesh);
        this.shootTimer = SHOOT_CD;
        sound.shoot();
    }

    // ─── Damage ───────────────────────────────────────────────────────────────
    takeDamage(sourcePos?: THREE.Vector3) {
        if (this.invincible > 0 || globals.gameState === STATES.GAME_OVER) return;

        globals.lives = Math.max(0, globals.lives - 1);
        this.invincible = 2.5;
        triggerScreenShake();
        sound.enemyHit(sourcePos);

        if (globals.lives <= 0) {
            globals.setGameState(STATES.GAME_OVER);
        } else if (Math.random() > 0.55) {
            globals.setGameState(STATES.QUIZ);
        }
        this.syncHUD();
    }

    // ─── HUD Sync ─────────────────────────────────────────────────────────────
    syncHUD() {
        EventBus.emit('sync-hud', {
            score    : Math.floor(globals.score),
            coins    : globals.coinCount,
            lives    : globals.lives,
            health   : globals.lives,
            maxHealth: 3,
            level    : globals.currentLevel,
            dashCooldown: this.dashCooldown,
        });
    }

    // ─── Particles ────────────────────────────────────────────────────────────
    spawnParticles(pos: THREE.Vector3, color: number, count = 6) {
        const geo = new THREE.SphereGeometry(0.11, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ color });
        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            const a = Math.random() * Math.PI * 2;
            const s = Math.random() * 5 + 1.5;
            this.scene.add(mesh);
            this.particles.push({
                mesh,
                vx: Math.cos(a) * s,
                vy: Math.random() * 7 + 2,
                vz: Math.sin(a) * s,
                life: 1, maxLife: 1
            });
        }
    }

    // ─── Procedural Animation ─────────────────────────────────────────────────
    private animateMan(dt: number) {
        this.animTime += dt;
        const t    = this.animTime;
        const armL = this.playerParts['armL'];
        const armR = this.playerParts['armR'];
        const legL = this.playerParts['legL'];
        const legR = this.playerParts['legR'];
        const torso= this.playerParts['torso'] as THREE.Mesh;
        const head = this.playerParts['head'] as THREE.Object3D;
        if (!armL || !armR || !legL || !legR || !torso || !head) return;

        const inAir = this.jumpCount > 0;
        if (inAir) {
            const rising = this.vel.y > 0;
            const ta = rising ? -Math.PI * 0.72 : Math.PI * 0.22;
            const tl = rising ?  Math.PI * 0.16 : -Math.PI * 0.1;
            const k  = 12 * dt;
            armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, ta, k);
            armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, ta, k);
            legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, tl, k);
            legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, tl * 0.5, k);
            torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, rising ? -0.08 : 0.12, k);
            (torso as any).position.y = 0;
        } else {
            const spd = 17;
            const amp = 0.9;
            legL.rotation.x = Math.sin(t * spd) * amp;
            legR.rotation.x = Math.sin(t * spd + Math.PI) * amp;
            armL.rotation.x = Math.sin(t * spd + Math.PI) * amp * 0.65;
            armR.rotation.x = Math.sin(t * spd) * amp * 0.65;
            armL.rotation.z =  0.22 + Math.sin(t * spd) * 0.04;
            armR.rotation.z = -0.22 - Math.sin(t * spd) * 0.04;
            (torso as any).position.y = Math.abs(Math.sin(t * spd * 2)) * 0.065;
            torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, 0.14, 5 * dt);
            head.rotation.x  = Math.sin(t * spd) * 0.07;
        }

        // Lean left/right
        let tY = Math.PI;
        if (this.keys['ArrowLeft']  || this.keys['KeyA']) tY = Math.PI + 0.3;
        if (this.keys['ArrowRight'] || this.keys['KeyD']) tY = Math.PI - 0.3;
        this.player.rotation.y = THREE.MathUtils.lerp(this.player.rotation.y, tY, 9 * dt);
    }

    // ─── Asset Update ─────────────────────────────────────────────────────────
    applyCharacterColors() {
        const char   = globals.selectedCharacter;
        const shirt  = this.C.shirt[char]  ?? this.C.shirt['default'];
        const pants  = this.C.pants[char]  ?? this.C.pants['default'];
        const torso  = this.playerMesh;
        (torso.material as THREE.MeshStandardMaterial).color.setHex(shirt);
        (torso.material as THREE.MeshStandardMaterial).needsUpdate = true;

        ['legL','legR'].forEach(k => {
            const leg = this.playerParts[k];
            if (leg) {
                const mesh = leg.children[0] as THREE.Mesh;
                if (mesh) (mesh.material as THREE.MeshStandardMaterial).color.setHex(pants);
            }
        });

        // GLTF custom model
        if (globals.customAssets.isPlayer3D && globals.customAssets.player) {
            this.player.traverse(c => { if (c.name === 'customModel') this.player.remove(c); });
            this.playerMesh.visible = false;
            this.mixer = undefined;
            this.playerAnimations = {};
            new GLTFLoader().load(globals.customAssets.player, (gltf) => {
                const model = gltf.scene;
                model.name  = 'customModel';
                const box   = new THREE.Box3().setFromObject(model);
                const size  = box.getSize(new THREE.Vector3());
                const scale = 1.5 / size.y;
                model.scale.setScalar(scale);
                const center = box.getCenter(new THREE.Vector3());
                model.position.set(-center.x * scale, (-box.min.y) * scale - PH / 2, -center.z * scale);
                this.player.rotation.y = Math.PI;
                this.player.add(model);
                if (gltf.animations?.length) {
                    this.mixer = new THREE.AnimationMixer(model);
                    gltf.animations.forEach(clip => {
                        const n = clip.name.toLowerCase();
                        const a = this.mixer!.clipAction(clip);
                        this.playerAnimations[n] = a;
                        if (n.includes('idle')) this.playerAnimations['idle'] = a;
                        if (n.includes('run') || n.includes('walk')) this.playerAnimations['run'] = a;
                        if (n.includes('jump')) this.playerAnimations['jump'] = a;
                    });
                    this.playAnim('idle');
                }
            });
        } else if (globals.customAssets.player && !globals.customAssets.isPlayer3D) {
            const tex = new THREE.TextureLoader().load(globals.customAssets.player);
            (this.playerMesh.material as THREE.MeshStandardMaterial).map = tex;
            (this.playerMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
        }
    }

    private playAnim(name: string) {
        if (!this.mixer || !this.playerAnimations[name]) return;
        if (this.currentAnim === this.playerAnimations[name]) return;
        this.currentAnim?.fadeOut(0.15);
        this.currentAnim = this.playerAnimations[name];
        this.currentAnim.reset().fadeIn(0.15).play();
    }

    // ─── Invincibility Blink ─────────────────────────────────────────────────
    private applyBlink() {
        const blink = this.invincible > 0 && (Math.floor(Date.now() / 150) % 2 === 0);
        this.player.traverse(child => {
            if ((child as any).isMesh) {
                const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                m.transparent = blink;
                m.opacity = blink ? 0.3 : 1.0;
            }
        });
    }

    // ─── Main Update (called once per frame, only when RUNNING) ───────────────
    private update(dt: number) {
        globals.score += dt * 12;
        this.distZ    += dt;

        // Timers
        if (this.invincible  > 0) this.invincible  -= dt;
        if (this.dashCooldown> 0) this.dashCooldown -= dt;
        if (this.shootTimer  > 0) this.shootTimer   -= dt;
        if (this.dashTimer   > 0) this.dashTimer    -= dt;
        if (this.dashTimer   <= 0) this.isDashing = false;

        this.applyBlink();

        // Animation
        if (this.mixer) {
            this.mixer.update(dt);
            this.playAnim(this.jumpCount > 0 ? 'jump' : 'run');
        } else {
            this.animateMan(dt);
        }

        // ── Movement ──
        const worldSpeed = WORLD_SPEED_BASE * (1 + (globals.currentLevel || 0) * 0.07);
        const moveZ      = worldSpeed * dt;
        const hSpeed     = this.isDashing ? DASH_SPEED : PLAYER_SPEED;

        if (this.keys['ArrowLeft']  || this.keys['KeyA']) this.player.position.x -= hSpeed * dt;
        if (this.keys['ArrowRight'] || this.keys['KeyD']) this.player.position.x += hSpeed * dt;
        this.player.position.x = Math.max(-9, Math.min(9, this.player.position.x));

        // ── Gravity ──
        let grav = GRAVITY_ACC;
        if (this.jumpCount > 0 && this.jumpHeld && this.vel.y > 0.5) grav *= JUMP_HOLD_MULT;
        if (this.vel.y < -1) grav *= FAST_FALL_MULT;
        this.vel.y += grav * dt;
        this.vel.y  = Math.max(this.vel.y, -40);        // terminal velocity
        this.player.position.y += this.vel.y * dt;

        // ── Player collision box ──
        const pos  = this.player.position;
        const pBox = makePlayerBox(pos);
        const pBot = pos.y - PH / 2;

        // ── Platform collision ──
        let onGround = false;

        for (let i = this.platforms.length - 1; i >= 0; i--) {
            const plat = this.platforms[i];
            plat.mesh.position.z += moveZ;

            // Cull far platforms
            if (plat.mesh.position.z > 20) {
                this.scene.remove(plat.mesh);
                this.platforms.splice(i, 1);
                continue;
            }

            // Broad-phase: skip if far in Z
            const dz = Math.abs(plat.mesh.position.z - pos.z);
            if (dz > plat.halfD + 2) continue;

            const pMeshBox = new THREE.Box3().setFromObject(plat.mesh);
            if (!pBox.intersectsBox(pMeshBox)) continue;

            // Recalculate top from mesh geometry
            const meshTop = plat.mesh.position.y + (plat.mesh.geometry as THREE.BoxGeometry).parameters.height / 2;

            // Landing on top
            if (this.vel.y <= 1 && pBot >= meshTop - 0.6) {
                pos.y      = meshTop + PH / 2;
                this.vel.y = 0;
                this.jumpCount = 0;
                this.jumpHeld  = false;
                onGround       = true;

                if      (plat.type === 'lava') {
                    this.takeDamage();
                    this.vel.y     = JUMP_FORCE * 0.65;
                    this.jumpCount = 1;
                    if (globals.gameState !== STATES.RUNNING) return;
                } else if (plat.type === 'bounce') {
                    this.vel.y     = JUMP_FORCE * 1.65;
                    this.jumpCount = 1;
                    this.spawnParticles(new THREE.Vector3(pos.x, meshTop, pos.z), this.C.bounce, 8);
                    this.lastSafeX = pos.x;
                    this.lastSafeY = meshTop;
                } else if (plat.type === 'breakable') {
                    this.spawnParticles(new THREE.Vector3(plat.mesh.position.x, meshTop, plat.mesh.position.z), this.C.breakable, 10);
                    this.scene.remove(plat.mesh);
                    this.platforms.splice(i, 1);
                } else {
                    // Stable platform: update safety
                    this.lastSafeX = pos.x;
                    this.lastSafeY = meshTop;
                }
            } else {
                // Side collision — stricter inner box
                const inner = new THREE.Box3().setFromCenterAndSize(
                    pos,
                    new THREE.Vector3(PW * 0.6, PH * 0.6, 0.34)
                );
                if (inner.intersectsBox(pMeshBox) && this.invincible <= 0) {
                    this.takeDamage();
                    if (globals.gameState !== STATES.RUNNING) return;
                }
            }
        }

        if (globals.gameState !== STATES.RUNNING) return;

        // Fall out of world
        if (!onGround && pos.y < -15) {
            sound.fall();
            this.takeDamage();
            if (globals.gameState === STATES.RUNNING) {
                // Respawn at safe coordinates
                pos.set(this.lastSafeX, this.lastSafeY + 5, 0);
                this.vel.set(0, 0, 0);
                this.jumpCount  = 0;
            }
            return;
        }

        // ── Coins & Powerups ──
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const c = this.coins[i];
            c.mesh.position.z += moveZ;
            c.mesh.rotation.y += (c.kind === 'coin' ? 3 : 2) * dt;

            if (c.mesh.position.z > 20) {
                this.scene.remove(c.mesh); this.coins.splice(i, 1); continue;
            }

            if (pBox.intersectsBox(new THREE.Box3().setFromObject(c.mesh))) {
                globals.coinCount++;
                globals.score += c.kind === 'powerup' ? 150 : 50;
                this.spawnParticles(c.mesh.position, c.kind === 'powerup' ? this.C.powerup : this.C.coin, 5);
                this.scene.remove(c.mesh); this.coins.splice(i, 1);
                sound.coin(c.mesh.position);
                this.syncHUD();
            }
        }

        // ── Enemies ──
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.mesh.position.z += moveZ;
            e.mesh.rotation.y += 1.8 * dt;

            if (e.mesh.position.z > 20) {
                this.scene.remove(e.mesh); this.enemies.splice(i, 1); continue;
            }

            if (e.type === 'moving') {
                e.mesh.position.x += e.dir * 3.5 * dt;
                if (Math.abs(e.mesh.position.x - e.startX) > 2.2) e.dir *= -1;
            }

            const eBox = new THREE.Box3().setFromObject(e.mesh);
            if (pBox.intersectsBox(eBox)) {
                const stomp = this.vel.y < -0.5 && pos.y > e.mesh.position.y + 0.25;
                if (stomp) {
                    this.vel.y     = JUMP_FORCE * 0.72;
                    this.jumpCount = 1;
                    this.spawnParticles(e.mesh.position, this.C.enemy, 12);
                    this.scene.remove(e.mesh); this.enemies.splice(i, 1);
                    globals.score += 200;
                    sound.enemyHit(e.mesh.position);
                } else if (this.invincible <= 0) {
                    this.takeDamage(e.mesh.position);
                    if (globals.gameState !== STATES.RUNNING) break;
                }
            }
        }

        if (globals.gameState !== STATES.RUNNING) return;

        // ── Projectiles ──
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p   = this.projectiles[i];
            const v   = (p as any)._vel as THREE.Vector3;
            p.position.add(v.clone().multiplyScalar(dt));

            if (p.position.z < this.player.position.z - 40 || p.position.z > 10) {
                this.scene.remove(p); this.projectiles.splice(i, 1); continue;
            }

            const pBox2 = new THREE.Box3().setFromObject(p);
            let hit = false;
            for (let j = this.enemies.length - 1; j >= 0; j--) {
                if (pBox2.intersectsBox(new THREE.Box3().setFromObject(this.enemies[j].mesh))) {
                    this.spawnParticles(this.enemies[j].mesh.position, this.C.enemy, 8);
                    this.scene.remove(this.enemies[j].mesh);
                    this.enemies.splice(j, 1);
                    globals.score += 100;
                    this.scene.remove(p); this.projectiles.splice(i, 1);
                    hit = true; break;
                }
            }
            if (!hit) {
                // Move platform-relative
                p.position.z += moveZ;
            }
        }

        // ── Level generation ──
        if (this.platforms.length < 14) this.generateSegment();

        // ── Camera follow ──
        const camTargetX = pos.x * 0.35;
        const camTargetY = pos.y + 5;
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, camTargetX, 3.5 * dt);
        this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, camTargetY, 3.5 * dt);
        this.camera.lookAt(pos.x * 0.25, pos.y + 0.5, pos.z - 7);

        // HUD every ~40 frames
        if (Math.random() < 0.025) this.syncHUD();
    }

    // ─── Render Loop (single RAF, always renders, physics only when RUNNING) ──
    private loop = (now: number) => {
        this.rafId  = requestAnimationFrame(this.loop);
        // Cap dt to avoid spiral-of-death on tab switch / freeze
        const dt    = Math.min((now - this.lastTime) / 1000, 0.05);
        this.lastTime = now;

        if (dt <= 0) { this.renderer.render(this.scene, this.camera); return; }

        // Particles always update for visual continuity
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt * 1.6;
            if (p.life <= 0) { this.scene.remove(p.mesh); this.particles.splice(i, 1); continue; }
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.vy -= 14 * dt;
            p.mesh.scale.setScalar(p.life);
        }

        if (globals.gameState === STATES.RUNNING) {
            this.update(dt);
        }

        this.renderer.render(this.scene, this.camera);
    };

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    cleanup() {
        cancelAnimationFrame(this.rafId);
        window.removeEventListener('resize',  this.onResize);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup',   this.onKeyUp);
        this.renderer.domElement.parentNode?.removeChild(this.renderer.domElement);
        this.renderer.dispose();
    }
}
