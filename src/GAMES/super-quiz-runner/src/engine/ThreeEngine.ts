import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { globals, STATES, triggerScreenShake } from './Globals';
import { sound } from './Sound';
import { EventBus } from '../EventBus';

export class ThreeEngine {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    clock: THREE.Clock;
    
    player: THREE.Object3D;
    playerMesh: THREE.Mesh;
    mixer?: THREE.AnimationMixer;
    playerAnimations: { [key: string]: THREE.AnimationAction } = {};
    currentAnim?: THREE.AnimationAction;
    
    platforms: THREE.Mesh[] = [];
    enemies: THREE.Mesh[] = [];
    coins: THREE.Mesh[] = [];
    projectiles: THREE.Mesh[] = [];
    enemyProjectiles: THREE.Mesh[] = [];
    particles: THREE.Mesh[] = [];
    
    playerVelocity = new THREE.Vector3(0, 0, 0);
    isJumping = false;
    canDoubleJump = false;
    isDashing = false;
    dashCooldown = 0;
    dashDuration = 0;
    invincibleTime = 0;
    shootCooldown = 0;
    
    keys: { [key: string]: boolean } = {};
    
    GRAVITY = -30;
    JUMP_FORCE = 15;
    MOVE_SPEED = 10;
    DASH_SPEED = 30;
    BASE_GAME_SPEED = 15;
    
    colors = {
        default: 0x3498db,
        ninja: 0x2c3e50,
        robot: 0x95a5a6,
        mage: 0x9b59b6,
        platform: 0x27ae60,
        lava: 0xe74c3c,
        coin: 0xf1c40f,
        enemy: 0xe74c3c,
        boss: 0x8e44ad,
        projectile: 0xf39c12,
    };
    
    bossActive = false;
    boss: THREE.Mesh | null = null;
    bossHealth = 100;
    bossShootTimer = 0;
    distanceTraveled = 0;
    nextPlatformZ = -20;
    
    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();
        if (globals.customAssets.background) {
            const loader = new THREE.TextureLoader();
            loader.load(globals.customAssets.background, (tex) => {
                this.scene.background = tex;
            });
        } else {
            this.scene.background = new THREE.Color(0x87ceeb);
        }
        this.scene.fog = new THREE.Fog(0x87ceeb, 20, 100);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 10);
        this.camera.lookAt(0, 0, -10);
        
        const listener = new THREE.AudioListener();
        this.camera.add(listener);
        (window as any).threeAudioListener = listener;
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        container.appendChild(this.renderer.domElement);
        
        globals.threeScene = this.scene;
        globals.threeCamera = this.camera;
        globals.threeRenderer = this.renderer;
        
        this.clock = new THREE.Clock();
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        this.scene.add(dirLight);
        
        // Initial Player Box
        const playerGeo = new THREE.BoxGeometry(1, 1.5, 0.5);
        const playerMat = new THREE.MeshStandardMaterial({ color: this.colors.default });
        this.playerMesh = new THREE.Mesh(playerGeo, playerMat);
        this.playerMesh.castShadow = true;
        this.playerMesh.receiveShadow = true;
        
        this.player = new THREE.Group();
        this.player.add(this.playerMesh);
        this.scene.add(this.player);
        
        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
        
        this.initLevel();
        this.animate();
    }
    
    initLevel() {
        [...this.platforms, ...this.enemies, ...this.coins, ...this.projectiles, ...this.enemyProjectiles, ...this.particles].forEach(obj => {
            this.scene.remove(obj);
        });
        this.platforms = []; this.enemies = []; this.coins = []; this.projectiles = []; this.enemyProjectiles = []; this.particles = [];
        
        if (this.boss) { this.scene.remove(this.boss); this.boss = null; }
        
        this.bossActive = false;
        this.distanceTraveled = 0;
        this.nextPlatformZ = -20;
        
        this.player.position.set(0, 2, 0);
        this.playerVelocity.set(0, 0, 0);
        
        this.updatePlayerAsset();
        
        this.createPlatform(0, 0, -10, 10, 1, 40, 'normal');
        for (let i = 0; i < 5; i++) { this.generateNextSegment(); }
        this.syncWithHUD();
    }
    
    createPlatform(x: number, y: number, z: number, w: number, h: number, d: number, type: string) {
        const geo = new THREE.BoxGeometry(w, h, d);
        let color = this.colors.platform;
        if (type === 'lava') color = this.colors.lava;
        else if (type === 'bounce') color = 0x3498db;
        else if (type === 'breakable') color = 0xbdc3c7;
        
        let mat: THREE.MeshStandardMaterial;
        if (globals.customAssets.platform) {
            const tex = new THREE.TextureLoader().load(globals.customAssets.platform);
            mat = new THREE.MeshStandardMaterial({ map: tex });
        } else {
            mat = new THREE.MeshStandardMaterial({ color });
        }
        
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.receiveShadow = true; mesh.castShadow = true;
        mesh.userData = { type, w, h, d };
        this.scene.add(mesh);
        this.platforms.push(mesh);
        return mesh;
    }
    
    generateNextSegment() {
        const gap = Math.random() * 5 + 2;
        this.nextPlatformZ -= gap;
        const pWidth = Math.random() * 6 + 4;
        const pLength = Math.random() * 15 + 10;
        const pX = (Math.random() - 0.5) * 10;
        
        const rand = Math.random();
        let type = 'normal';
        if (rand > 0.8) type = 'lava';
        else if (rand > 0.7) type = 'bounce';
        else if (rand > 0.6) type = 'breakable';
        
        this.createPlatform(pX, 0, this.nextPlatformZ - pLength/2, pWidth, 1, pLength, type);
        
        if (Math.random() > 0.5) {
            for (let i = 0; i < 3; i++) {
                this.createCoin(pX, 1.5, this.nextPlatformZ - pLength/2 + (i-1)*2);
            }
        }
        
        if (Math.random() > 0.6 && type !== 'lava') {
            const eType = Math.random() > 0.5 ? 'moving' : 'static';
            this.createEnemy(pX, 1, this.nextPlatformZ - pLength/2, eType);
        }
        
        if (Math.random() > 0.7) {
            this.createPowerup(pX, 2, this.nextPlatformZ - pLength/2);
        }
        this.nextPlatformZ -= pLength;
    }
    
    createPowerup(x: number, y: number, z: number) {
        const geo = new THREE.TorusGeometry(0.5, 0.2, 8, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.5 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.userData = { type: 'shield' }; // For now, all powerups are shields or generic
        this.scene.add(mesh);
        this.coins.push(mesh); // Can reuse the coins array for simple collection detection
    }
    
    createCoin(x: number, y: number, z: number) {
        const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16);
        const mat = new THREE.MeshStandardMaterial({ color: this.colors.coin, metalness: 0.8, roughness: 0.2 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.rotation.x = Math.PI / 2;
        this.scene.add(mesh);
        this.coins.push(mesh);
    }
    
    createEnemy(x: number, y: number, z: number, type: string) {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        let mat: THREE.MeshStandardMaterial;
        if (globals.customAssets.enemy) {
            const tex = new THREE.TextureLoader().load(globals.customAssets.enemy);
            mat = new THREE.MeshStandardMaterial({ map: tex });
        } else {
            mat = new THREE.MeshStandardMaterial({ color: this.colors.enemy });
        }
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.userData = { type, startX: x, dir: 1 };
        this.scene.add(mesh);
        this.enemies.push(mesh);
    }
    
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    onKeyDown(e: KeyboardEvent) {
        this.keys[e.code] = true;
        if (globals.gameState === STATES.RUNNING) {
            if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
                if (!this.isJumping) {
                    this.playerVelocity.y = this.JUMP_FORCE;
                    this.isJumping = true; this.canDoubleJump = true;
                    sound.jump();
                } else if (this.canDoubleJump) {
                    this.playerVelocity.y = this.JUMP_FORCE * 0.8;
                    this.canDoubleJump = false;
                    sound.jump();
                }
            }
            if (e.code === 'ShiftLeft' && this.dashCooldown <= 0) {
                this.isDashing = true; this.dashDuration = 0.2; this.dashCooldown = 2.0;
                sound.dash();
            }
            if (e.code === 'KeyF') this.shoot();
        }
    }
    
    onKeyUp(e: KeyboardEvent) { delete this.keys[e.code]; }
    
    shoot() {
        if (this.shootCooldown > 0) return;
        const geo = new THREE.SphereGeometry(0.3, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: this.colors.projectile });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(this.player.position);
        this.scene.add(mesh);
        this.projectiles.push(mesh);
        this.shootCooldown = 0.5;
        sound.shoot();
    }
    
    updatePlayerAsset() {
        const char = globals.selectedCharacter;
        const color = this.colors[char as keyof typeof this.colors] || this.colors.default;
        
        // Remove 3D model if it exists
        this.player.traverse(child => {
            if (child.name === 'customModel') {
               this.player.remove(child);
            }
        });
        this.playerMesh.visible = true;
        this.mixer = undefined;
        this.playerAnimations = {};

        if (globals.customAssets.isPlayer3D && globals.customAssets.player) {
            const loader = new GLTFLoader();
            loader.load(globals.customAssets.player, (gltf) => {
                this.playerMesh.visible = false;
                const model = gltf.scene;
                model.name = 'customModel';
                
                // Normalization (Scale to fit)
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const targetH = 1.5;
                const scale = targetH / size.y;
                model.scale.setScalar(scale);
                
                // Center bottom
                const center = box.getCenter(new THREE.Vector3());
                model.position.x = -center.x * scale;
                model.position.y = -box.min.y * scale - 0.75; // Offset to match box feet
                model.position.z = -center.z * scale;
                this.player.rotation.y = Math.PI; // Face forward
                
                this.player.add(model);
                
                // Animations
                if (gltf.animations && gltf.animations.length > 0) {
                    this.mixer = new THREE.AnimationMixer(model);
                    gltf.animations.forEach(clip => {
                        const name = clip.name.toLowerCase();
                        const action = this.mixer!.clipAction(clip);
                        this.playerAnimations[name] = action;
                        // Map common names
                        if (name.includes('idle')) this.playerAnimations['idle'] = action;
                        if (name.includes('run') || name.includes('walk')) this.playerAnimations['run'] = action;
                        if (name.includes('jump')) this.playerAnimations['jump'] = action;
                    });
                    this.playAnimation('idle');
                }
            });
        } else if (globals.customAssets.player) {
            const tex = new THREE.TextureLoader().load(globals.customAssets.player);
            (this.playerMesh.material as THREE.MeshStandardMaterial).map = tex;
            (this.playerMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
        } else {
            (this.playerMesh.material as THREE.MeshStandardMaterial).map = null;
            (this.playerMesh.material as THREE.MeshStandardMaterial).color.setHex(color);
            (this.playerMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
        }
    }

    playAnimation(name: string) {
        if (!this.mixer || !this.playerAnimations[name]) return;
        if (this.currentAnim === this.playerAnimations[name]) return;
        
        if (this.currentAnim) this.currentAnim.fadeOut(0.2);
        this.currentAnim = this.playerAnimations[name];
        this.currentAnim.reset().fadeIn(0.2).play();
    }

    takeDamage() {
        if (this.invincibleTime > 0) return;
        globals.lives--;
        this.invincibleTime = 2.0;
        triggerScreenShake();
        sound.enemyHit();
        
        this.player.traverse(child => {
            if ((child as any).isMesh) {
                const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                mat.transparent = true;
                mat.opacity = 0.5;
            }
        });
        
        if (globals.lives <= 0) {
            globals.setGameState(STATES.GAME_OVER);
        } else {
            if (Math.random() > 0.5) {
                globals.setGameState(STATES.QUIZ);
            }
        }
        this.syncWithHUD();
    }
    
    syncWithHUD() {
        EventBus.emit('sync-hud', {
            score: Math.floor(globals.score),
            coins: globals.coinCount,
            lives: globals.lives,
            health: globals.lives, // Simplified for now
            maxHealth: 3,
            level: globals.currentLevel,
            bossHealth: this.bossActive ? this.bossHealth : null,
            dashCooldown: this.dashCooldown
        });
    }
    
    update(dt: number) {
        if (globals.gameState !== STATES.RUNNING) return;
        
        if (this.invincibleTime > 0) {
            this.invincibleTime -= dt;
            if (this.invincibleTime <= 0) {
                 this.player.traverse(child => {
                    if ((child as any).isMesh) {
                        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                        mat.opacity = 1.0;
                    }
                });
            }
        }
        if (this.dashCooldown > 0) this.dashCooldown -= dt;
        if (this.shootCooldown > 0) this.shootCooldown -= dt;
        
        if (this.mixer) this.mixer.update(dt);
        
        if (this.isJumping) this.playAnimation('jump');
        else if (Math.abs(this.playerVelocity.x) > 0.1 || globals.gameState === STATES.RUNNING) this.playAnimation('run');
        else this.playAnimation('idle');
        
        const currentSpeed = this.BASE_GAME_SPEED * (1 + globals.currentLevel * 0.1);
        this.distanceTraveled += currentSpeed * dt;
        globals.score += dt * 10;
        
        let moveSpeed = this.MOVE_SPEED;
        if (this.isDashing) {
            this.dashDuration -= dt;
            if (this.dashDuration <= 0) this.isDashing = false;
            moveSpeed = this.DASH_SPEED;
        }
        
        if (this.keys['ArrowLeft'] || this.keys['KeyA']) this.player.position.x -= moveSpeed * dt;
        if (this.keys['ArrowRight'] || this.keys['KeyD']) this.player.position.x += moveSpeed * dt;
        this.player.position.x = Math.max(-8, Math.min(8, this.player.position.x));
        
        this.playerVelocity.y += this.GRAVITY * dt;
        this.player.position.y += this.playerVelocity.y * dt;
        
        const moveZ = currentSpeed * dt;
        const playerBox = new THREE.Box3().setFromObject(this.player);
        let onGround = false;
        
        for (let i = this.platforms.length - 1; i >= 0; i--) {
            const p = this.platforms[i];
            p.position.z += moveZ;
            const pBox = new THREE.Box3().setFromObject(p);
            if (playerBox.intersectsBox(pBox)) {
                if (this.playerVelocity.y < 0 && this.player.position.y - 0.5 >= pBox.max.y - 0.2) {
                    this.player.position.y = pBox.max.y + 0.75;
                    this.playerVelocity.y = 0; this.isJumping = false; onGround = true;
                    if (p.userData.type === 'lava') {
                        this.takeDamage(); this.playerVelocity.y = this.JUMP_FORCE * 0.8;
                    } else if (p.userData.type === 'bounce') {
                        this.playerVelocity.y = this.JUMP_FORCE * 1.5; this.isJumping = true;
                    } else if (p.userData.type === 'breakable') {
                        this.createParticles(p.position.x, p.position.y, p.position.z, 0xbdc3c7);
                        this.scene.remove(p); this.platforms.splice(i, 1);
                    }
                } else { this.takeDamage(); }
            }
            if (p.position.z > 15) { this.scene.remove(p); this.platforms.splice(i, 1); }
        }
        
        if (!onGround && this.player.position.y < -5) {
            this.takeDamage(); this.player.position.y = 10; this.playerVelocity.y = 0;
        }
        
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const c = this.coins[i];
            c.position.z += moveZ; c.rotation.z += 5 * dt;
            if (playerBox.intersectsBox(new THREE.Box3().setFromObject(c))) {
                globals.coinCount++; globals.score += 50;
                this.scene.remove(c); this.coins.splice(i, 1); sound.coin(c.position); this.syncWithHUD();
            } else if (c.position.z > 15) { this.scene.remove(c); this.coins.splice(i, 1); }
        }
        
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.position.z += moveZ;
            if (e.userData.type === 'moving') {
                e.position.x += e.userData.dir * 5 * dt;
                if (Math.abs(e.position.x - e.userData.startX) > 3) e.userData.dir *= -1;
            }
            if (playerBox.intersectsBox(new THREE.Box3().setFromObject(e))) {
                if (this.playerVelocity.y < 0 && this.player.position.y > e.position.y + 0.5) {
                    this.playerVelocity.y = this.JUMP_FORCE * 0.8;
                    this.createParticles(e.position.x, e.position.y, e.position.z, this.colors.enemy);
                    this.scene.remove(e); this.enemies.splice(i, 1);
                    globals.score += 100; sound.enemyHit(e.position);
                } else { this.takeDamage(); }
            } else if (e.position.z > 15) { this.scene.remove(e); this.enemies.splice(i, 1); }
        }
        
        if (this.platforms.length < 10) this.generateNextSegment();
        
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.player.position.x * 0.5, 5 * dt);
        this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.player.position.y + 3, 5 * dt);
        this.camera.lookAt(this.player.position.x, this.player.position.y, this.player.position.z - 10);
        
        if (Math.random() < 0.02) this.syncWithHUD();
    }
    
    createParticles(x: number, y: number, z: number, color: number) {
        // Simple particle system using cubes
        const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const mat = new THREE.MeshBasicMaterial({ color });
        for (let i = 0; i < 5; i++) {
            const p = new THREE.Mesh(geo, mat);
            p.position.set(x, y, z);
            p.userData = { vx: (Math.random()-0.5)*5, vy: Math.random()*5, vz: (Math.random()-0.5)*5, life: 1 };
            this.scene.add(p);
            this.particles.push(p);
        }
    }
    
    animate() {
        requestAnimationFrame(this.animate.bind(this));
        if (globals.gameState === STATES.RUNNING) {
            const dt = Math.min(this.clock.getDelta(), 0.1);
            this.update(dt);
            
            // Update particles
            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                p.userData.life -= 0.05;
                if (p.userData.life <= 0) {
                    this.scene.remove(p); this.particles.splice(i, 1);
                } else {
                    p.position.x += p.userData.vx * 0.1;
                    p.position.y += p.userData.vy * 0.1;
                    p.position.z += p.userData.vz * 0.1;
                    p.userData.vy -= 0.3;
                    p.scale.setScalar(p.userData.life);
                }
            }
        }
        this.renderer.render(this.scene, this.camera);
    }
    
    cleanup() {
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        window.removeEventListener('keydown', this.onKeyDown.bind(this));
        window.removeEventListener('keyup', this.onKeyUp.bind(this));
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        this.renderer.dispose();
    }
}
