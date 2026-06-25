import Phaser from "phaser";
import { createDudeAnims } from "../anims/dude/dudeAnims";
import type { AIConfig } from "../characters/AIConfig";
import AIEnemy from "../characters/AIEnemy";
import { playableControls } from "../characters/Controls";
import EnemyBrain from "../characters/EnemyBrain";
import Player from "../characters/Player";
import { EventBus } from "../EventBus";
import {
	OnlineManager,
	type OnlineStateHandler,
	type OnlineStatusHandler,
} from "../online/OnlineManager";
import type { GameSnapshot } from "../online/types";
import {
	tickPlayer,
	tickBullet,
	canFire,
	isBulletOutOfBounds,
	bulletHitsPlatform,
	bulletHitsPlayer,
	BULLET_DAMAGE,
	GRAVITY,
	platforms as sharedPlatforms,
	type PlayerPosition,
	type BulletState,
	PLAYER_WIDTH,
	PLAYER_HEIGHT,
	WORLD_LEFT,
	WORLD_RIGHT,
	WORLD_BOTTOM,
	ATTACK_COOLDOWN,
} from "../simulation/Physics";
import { MovementState } from "../characters/playerStates";

interface LocalBullet extends BulletState {
	active: boolean;
	sprite: Phaser.GameObjects.Sprite;
}

interface DiagnosticFrame {
	playerX: number;
	playerY: number;
	playerVx: number;
	playerVy: number;
	enemyX: number;
	enemyY: number;
	enemyVx: number;
	enemyVy: number;
	cameraX: number;
	cameraY: number;
	t: number;
	dt: number;
	physicsSteps: number;
}

interface JitterEvent {
	frame: number;
	type: string;
	delta: number;
	expectedMax: number;
	severity: number;
}

const PHYSICS_DT = 1 / 60;
const MAX_PHYSICS_STEPS = 5;

const DIAG_JITTER_X = 35;
const DIAG_JITTER_Y = 25;
const DIAG_JITTER_CAM = 15;

function friLerp(current: number, target: number, factor: number, dtSec: number): number {
	const t = 1 - Math.pow(1 - factor, dtSec * 60);
	return current + (target - current) * t;
}

export default class Game extends Phaser.Scene {
	private player?: Player;
	private aiEnemy?: AIEnemy;
	private cursors!: Record<string, Phaser.Input.Keyboard.Key>;
	private hpText?: Phaser.GameObjects.Text;
	private enemyHpText?: Phaser.GameObjects.Text;
	private aiVsAIMode = false;
	private playerBrain?: EnemyBrain;
	private resetScheduled = false;
	private startPlayerX = 100;
	private startPlayerY = 500;
	private startEnemyX = 700;
	private startEnemyY = 500;

	private playerPhys: PlayerPosition = { x: 100, y: 500, vx: 0, vy: 0, grounded: false, wallTouch: "none", wallJumpTimer: 0 };
	private enemyPhys: PlayerPosition = { x: 700, y: 500, vx: 0, vy: 0, grounded: false, wallTouch: "none", wallJumpTimer: 0 };

	private localBulletData: LocalBullet[] = [];
	private nextBulletId = 0;
	private bulletPool: Phaser.GameObjects.Sprite[] = [];
	private remoteTargetX = 0;
	private remoteTargetY = 0;

	private onlineManager?: OnlineManager;
	private onlineMode = false;
	private onlineAIMode = false;
	private remoteSprite?: Phaser.GameObjects.Sprite;
	private remoteHp = 100;
	private onlineStatusText?: Phaser.GameObjects.Text;
	private onlineBulletSprites: Phaser.GameObjects.Sprite[] = [];
	private onlineInitialized = false;

	private physicsAccumulator = 0;
	private cachedPlayerInput = { left: false, right: false, up: false };
	private cachedEnemyInput = { left: false, right: false, up: false };
	private cachedAimAngle = 0;
	private enemyEvadeActive = false;
	private enemyEvadeDir = 1;
	private cachedPlayerAttack = false;

	private _diagActive = false;
	private _diagStartTime = 0;
	private _diagDuration = 0;
	private _diagFrames: DiagnosticFrame[] = [];
	private _diagPrev: { px: number; py: number; ex: number; ey: number; cx: number; cy: number } = { px: 0, py: 0, ex: 0, ey: 0, cx: 0, cy: 0 };
	private _diagFrameCount = 0;
	private _diagJitter: JitterEvent[] = [];
	private _diagRecon: { frame: number; serverX: number; clientX: number; serverY: number; clientY: number; correction: number }[] = [];
	private _diagSkipJitter = false;
	private _diagPhysicsSteps = 0;

	constructor() {
		super("Game");
	}

	create() {
		const camera = this.cameras.main;
		createDudeAnims(this.anims);

		camera.setBounds(0, 0, 800, 600, true);

		this.add.image(400, 300, "sky");
		this.add.image(400, 568, "ground").setScale(2);
		this.add.image(50, 250, "ground");
		this.add.image(750, 220, "ground");
		this.add.image(600, 400, "ground");

		this.player = new Player(
			this,
			this.startPlayerX,
			this.startPlayerY,
			"dude",
		);
		this.playerPhys = { x: this.startPlayerX, y: this.startPlayerY, vx: 0, vy: 0, grounded: false, wallTouch: "none", wallJumpTimer: 0 };

		this.aiEnemy = new AIEnemy(
			this,
			this.startEnemyX,
			this.startEnemyY,
			"dude",
		);
		this.enemyPhys = { x: this.startEnemyX, y: this.startEnemyY, vx: 0, vy: 0, grounded: false, wallTouch: "none", wallJumpTimer: 0 };

		this.hpText = this.add.text(16, 16, `hp: ${this.player.hp}`, {
			fontSize: "32px",
			color: "#000",
		});

		this.enemyHpText = this.add.text(580, 16, `enemy hp: ${this.aiEnemy.hp}`, {
			fontSize: "32px",
			color: "#000",
		});

		this.resetFight();

		this.cursors = this.input.keyboard!.addKeys(playableControls) as Record<
			string,
			Phaser.Input.Keyboard.Key
		>;

		this.input.keyboard?.on("keydown-P", () => this.toggleAIVsAI());

		this.input.mouse?.disableContextMenu();

		this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
			const playerVector = new Phaser.Math.Vector2(
				this.player!.x,
				this.player!.y,
			);
			this.player!.setMouseAngle(
				Phaser.Math.Angle.BetweenPoints(playerVector, pointer),
			);
		});

		this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
			if (this.onlineMode) return;
			this.player!.machineAttack(pointer, this);
		});

		EventBus.on("enemy-hp-changed", (hp: number) => {
			this.enemyHpText?.setText(`enemy hp: ${Math.max(0, hp)}`);
		});

		const win = window as unknown as Record<string, unknown>;
		win.__toggleAIVsAI = () => this.toggleAIVsAI();
		win.__gameState = () => ({
			aiVsAIMode: this.aiVsAIMode,
			onlineMode: this.onlineMode,
			onlineAIMode: this.onlineAIMode,
			playerHP: this.player?.hp,
			enemyHP: this.aiEnemy?.hp ?? this.remoteHp,
			playerState: this.playerBrain?.getCurrentState(),
			enemyState: this.aiEnemy?.getCurrentAIState(),
		});
		win.__physicsDiagnostic = (durationMs = 5000) => this.startDiagnostic(durationMs);

		EventBus.emit("current-scene-ready", this);

		const params = new URLSearchParams(window.location.search);
		this.onlineMode = params.get("online") === "true";
		this.onlineAIMode = params.get("ai") === "true";
		if (this.onlineMode) {
			this.initOnlineMode();
		}
	}

	private initOnlineMode() {
		this.onlineStatusText = this.add
			.text(400, 300, "Connecting...", {
				fontSize: "24px",
				color: "#fff",
			})
			.setOrigin(0.5);

		this.onlineManager = new OnlineManager(
			`${location.protocol}//${location.hostname}`,
			9208,
		);

		const onStatus: OnlineStatusHandler = (msg) => {
			console.log(`[ONLINE] ${msg}`);
			if (this.onlineStatusText) {
				this.onlineStatusText.setText(msg);
			}
		};

		const onState: OnlineStateHandler = (snap: GameSnapshot) => {
			this.applySnapshot(snap);
		};

		this.onlineManager.connect(onState, onStatus);

		this.aiEnemy?.setVisible(false);
		this.aiEnemy?.setActive(false);

		if (this.onlineAIMode) {
			this.playerBrain = new EnemyBrain(this.generateFightConfig());
			console.log("[AI-ONLINE] AI brain created for local player");
		}

		this.cameras.main.setScroll(0, 0);
	}

	private applySnapshot(snap: GameSnapshot) {
		if (!this.player) return;

		for (const p of snap.players) {
			if (p.id === this.onlineManager?.myId) {
				this.player.hp = p.hp;
				this.hpText?.setText(`hp: ${Math.max(0, p.hp)}`);

				const errX = p.x - this.playerPhys.x;
				const errY = p.y - this.playerPhys.y;
				if (Math.abs(errX) > 100 || Math.abs(errY) > 100) {
					this.playerPhys.x = p.x;
					this.playerPhys.y = p.y;
				} else {
					this.playerPhys.x += errX * 0.15;
					this.playerPhys.y += errY * 0.15;
				}
				this.player.setPosition(this.playerPhys.x, this.playerPhys.y);

				if (this._diagActive) {
					this._diagRecon.push({
						frame: this._diagFrameCount,
						serverX: p.x,
						clientX: this.playerPhys.x,
						serverY: p.y,
						clientY: this.playerPhys.y,
						correction: Math.sqrt(errX * errX + errY * errY),
					});
				}

				if (p.hp <= 0) {
					this.player.setAlpha(0.3);
				} else {
					this.player.setAlpha(1);
				}

				const facingKey = p.facingDir < 0 ? "left" : "right";
				if (this.player.anims.currentAnim?.key !== facingKey) {
					this.player.anims.play(facingKey, true);
				}
			} else {
				if (!this.remoteSprite) {
					this.remoteSprite = this.add.sprite(p.x, p.y, "dude");
					this.remoteSprite.setOrigin(0.5);
				}
				this.remoteTargetX = p.x;
				this.remoteTargetY = p.y;
				this.remoteHp = p.hp;
				this.enemyHpText?.setText(`enemy hp: ${Math.max(0, p.hp)}`);

				const facingKey = p.facingDir < 0 ? "left" : "right";
				if (this.remoteSprite.anims.currentAnim?.key !== facingKey) {
					this.remoteSprite.anims.play(facingKey, true);
				}

				if (p.hp <= 0) {
					this.remoteSprite?.setAlpha(0.3);
				} else {
					this.remoteSprite?.setAlpha(1);
				}
			}
		}

		if (!this.onlineInitialized && snap.players.length >= 2) {
			this.onlineInitialized = true;
			this.onlineStatusText?.setText("");
		}

		while (this.onlineBulletSprites.length < snap.bullets.length) {
			const b = this.add.sprite(0, 0, "fireball");
			b.setOrigin(0.5);
			this.onlineBulletSprites.push(b);
		}

		for (let i = 0; i < this.onlineBulletSprites.length; i++) {
			const b = snap.bullets[i];
			if (b) {
				this.onlineBulletSprites[i].setPosition(b.x, b.y);
				this.onlineBulletSprites[i].setVisible(true);
			} else {
				this.onlineBulletSprites[i].setVisible(false);
			}
		}
	}

	private resetFight() {
		if (!this.player || !this.aiEnemy) return;
		this._diagSkipJitter = true;

		if (this.aiVsAIMode) {
			const playerConfig = this.generateFightConfig();
			const enemyConfig = this.generateFightConfig();
			if (this.playerBrain) {
				this.playerBrain = new EnemyBrain(playerConfig);
			}
			this.aiEnemy.updateConfig(enemyConfig);
			this.aiEnemy.resetBrain();
		}

		this.player.hp = 100;
		this.aiEnemy.hp = 100;

		this.playerPhys = { x: this.startPlayerX, y: this.startPlayerY, vx: 0, vy: 0, grounded: false, wallTouch: "none", wallJumpTimer: 0 };
		this.enemyPhys = { x: this.startEnemyX, y: this.startEnemyY, vx: 0, vy: 0, grounded: false, wallTouch: "none", wallJumpTimer: 0 };

		this.player.setPosition(this.startPlayerX, this.startPlayerY);
		this.aiEnemy.setPosition(this.startEnemyX, this.startEnemyY);

		this.player.bullets.deactivateAll();
		this.aiEnemy.bullets.deactivateAll();
		for (const b of this.localBulletData) {
			b.sprite.setVisible(false);
		}
		this.localBulletData = [];

		this.hpText?.setText("hp: 100");
		this.enemyHpText?.setText("enemy hp: 100");
		this.resetScheduled = false;
	}

	private generateFightConfig(): AIConfig {
		const baseSkill = 4 + Math.floor(Math.random() * 4);
		return {
			skillLevel: baseSkill,
			reactionTime: 150 + Math.floor(Math.random() * 250),
			accuracy: 0.45 + Math.random() * 0.4,
			aggressiveness: 0.35 + Math.random() * 0.45,
			dodgeChance: 0.2 + Math.random() * 0.4,
		};
	}

	private toggleAIVsAI() {
		this.aiVsAIMode = !this.aiVsAIMode;
		if (this.aiVsAIMode && this.player && this.aiEnemy) {
			this.playerBrain = new EnemyBrain(this.generateFightConfig());
			this.resetFight();
			this.player.setAIOverride({
				moveLeft: false,
				moveRight: false,
				jump: false,
				attack: false,
				aimAngle: 0,
				evadeActive: false,
				switchToMelee: false,
				switchToRanged: true,
			});
			console.log("=== AI VS AI MODE ENABLED ===");
			console.log(`Player HP: ${this.player.hp}, Enemy HP: ${this.aiEnemy.hp}`);
			console.log("Type window.__gameState() to inspect, or press 'P' to exit");
		} else {
			this.playerBrain = undefined;
			this.player?.setAIOverride(null);
			console.log("=== AI VS AI MODE DISABLED ===");
		}
	}

	private onPlayerBulletHitEnemy(b: LocalBullet) {
		if (!this.aiEnemy || this.aiEnemy.hp <= 0) return;
		this.aiEnemy.takeDamage(BULLET_DAMAGE);
		b.active = false;
		console.log(`[FIGHT] Player bullet hit enemy! Enemy HP: ${Math.max(0, this.aiEnemy.hp)}`);
		if (this.aiEnemy.hp <= 0) {
			console.log("[FIGHT] Enemy defeated!");
			this.scheduleReset();
		}
	}

	private onEnemyBulletHitPlayer(b: LocalBullet) {
		if (!this.player || this.player.hp <= 0) return;
		this.player.takeDamage(BULLET_DAMAGE);
		b.active = false;
		this.hpText?.setText(`hp: ${Math.max(0, this.player.hp)}`);
		console.log(`[FIGHT] Enemy bullet hit player! Player HP: ${Math.max(0, this.player.hp)}`);
		if (this.player.hp <= 0) {
			console.log("[FIGHT] Player defeated!");
			this.scheduleReset();
		}
	}

	private scheduleReset() {
		if (!this.aiVsAIMode || this.resetScheduled) return;
		this.resetScheduled = true;
		this.time.delayedCall(2000, () => {
			this.resetScheduled = false;
			this.resetFight();
			console.log("=== FIGHT RESET ===");
			console.log("Both fighters restored to full HP");
		});
	}

	private hasLineOfSight(
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
	): boolean {
		const steps = 20;
		for (let i = 1; i < steps; i++) {
			const t = i / steps;
			const x = fromX + (toX - fromX) * t;
			const y = fromY + (toY - fromY) * t - 18;
			for (const p of sharedPlatforms) {
				if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
					return false;
				}
			}
		}
		return true;
	}

	// =============================================
	//  UPDATE LOOP
	// =============================================

	update(t: number, dt: number) {
		const dtSec = Math.min(dt / 1000, 0.05);

		if (this.onlineMode) {
			this.updateOnline(t, dt, dtSec);
		} else {
			this.updateOffline(t, dtSec);
		}

		if (this._diagActive) {
			this.recordDiagnosticFrame(t, dt);
		}
	}

	// =============================================
	//  OFFLINE MODE  (player vs AI)
	// =============================================

	private updateOffline(t: number, dtSec: number) {
		const now = this.game.loop.time;

		this.gatherInputs(t, dtSec, now);

		this._diagPhysicsSteps = 0;
		this.physicsAccumulator += dtSec;
		let steps = 0;
		while (this.physicsAccumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
			this.fixedPhysicsStep(PHYSICS_DT);
			this.physicsAccumulator -= PHYSICS_DT;
			steps++;
		}
		if (this._diagActive) this._diagPhysicsSteps = steps;

		this.applyPositions();

		this.handleAttacks(now);

		this.updateCamera(dtSec);
	}

	private gatherInputs(t: number, dtSec: number, now: number) {
		if (!this.player || !this.cursors) return;

		const isAIVsAI = this.aiVsAIMode && this.playerBrain && this.aiEnemy;

		if (isAIVsAI) {
			this.gatherAIInputs(t, dtSec);
		} else {
			this.gatherPlayerInput(t, now);
		}

		this.gatherEnemyInput(t, dtSec);
	}

	private gatherPlayerInput(t: number, now: number) {
		if (!this.player || !this.cursors) return;

		this.player.update(t, 16, this.cursors);

		let input = {
			left: this.cursors.left?.isDown ?? false,
			right: this.cursors.right?.isDown ?? false,
			up: this.cursors.up?.isDown ?? false,
		};

		if (this.player.movementState === MovementState.DASHING_LEFT) {
			this.playerPhys.vx = -1000;
			input = { left: false, right: false, up: false };
		} else if (this.player.movementState === MovementState.DASHING_RIGHT) {
			this.playerPhys.vx = 1000;
			input = { left: false, right: false, up: false };
		}

		this.cachedPlayerInput = input;
		this.cachedAimAngle = this.player.getMouseAngle();
	}

	private gatherAIInputs(t: number, dtSec: number) {
		if (!this.player || !this.playerBrain || !this.aiEnemy) return;

		const enemy = this.aiEnemy;
		const player = this.player;

		if (player.hp <= 0) return;

		const dx = enemy.x - player.x;
		const dy = enemy.y - player.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		const los = this.hasLineOfSight(player.x, player.y, enemy.x, enemy.y);

		const pInput = {
			playerX: enemy.x,
			playerY: enemy.y,
			selfX: player.x,
			selfY: player.y,
			distanceToPlayer: distance,
			playerFacingDirection: enemy.getFacingDirection(),
			touchingDown: this.playerPhys.grounded,
			touchingLeft: this.playerPhys.wallTouch === "left",
			touchingRight: this.playerPhys.wallTouch === "right",
			hasLineOfSight: los,
			selfHP: player.hp,
			enemyHP: enemy.hp,
		};

		const output = this.playerBrain.decide(pInput, t, dtSec * 1000);
		player.setAIOverride(output);

		this.cachedPlayerInput = {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		};
		this.cachedAimAngle = output.aimAngle;
		this.cachedPlayerAttack = output.attack;
		this.playerPhys.vx = 0;
	}

	private gatherEnemyInput(t: number, dtSec: number) {
		if (!this.aiEnemy || !this.player) return;
		if (this.aiEnemy.hp <= 0) return;

		const los = this.hasLineOfSight(
			this.enemyPhys.x,
			this.enemyPhys.y,
			this.playerPhys.x,
			this.playerPhys.y,
		);

		this.aiEnemy.update(
			t,
			dtSec * 1000,
			this.playerPhys.x,
			this.playerPhys.y,
			this.player!.getFacingDirection(),
			los,
			this.player.hp,
			this.enemyPhys.wallTouch,
		);

		const output = this.aiEnemy.lastAIOutput;

		this.cachedEnemyInput = {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		};
		this.enemyEvadeActive = output.evadeActive;
		this.enemyEvadeDir = output.moveLeft ? -1 : 1;
	}

	private fixedPhysicsStep(dt: number) {
		this.playerPhys = tickPlayer(this.playerPhys, this.cachedPlayerInput, dt);

		if (this.aiEnemy && this.aiEnemy.hp > 0) {
			if (this.enemyEvadeActive) {
				const dir = this.enemyEvadeDir;
				this.enemyPhys.vx = dir * 300;
				this.enemyPhys.vy += GRAVITY * dt;
				this.enemyPhys.x += this.enemyPhys.vx * dt;
				this.enemyPhys.y += this.enemyPhys.vy * dt;
				this.applyWorldBounds(this.enemyPhys);
				this.applyPlatformCollision(this.enemyPhys, dt);
			} else {
				this.enemyPhys = tickPlayer(this.enemyPhys, this.cachedEnemyInput, dt);
			}
		}

		for (const b of this.localBulletData) {
			if (b.active) {
				tickBullet(b, dt);
			}
		}
	}

	private applyPositions() {
		if (this.player) {
			this.player.setPosition(this.playerPhys.x, this.playerPhys.y);
			this.player.grounded = this.playerPhys.grounded;
		}
		if (this.aiEnemy && this.aiEnemy.hp > 0) {
			this.aiEnemy.setPosition(this.enemyPhys.x, this.enemyPhys.y);
			this.aiEnemy.grounded = this.enemyPhys.grounded;

			const output = this.aiEnemy.lastAIOutput;
			this.aiEnemy.lastFacingDirection = output.moveLeft ? -1 : output.moveRight ? 1 : this.aiEnemy.lastFacingDirection;
		}
	}

	private handleAttacks(now: number) {
		if (!this.player || !this.aiEnemy) return;

		if (!this.aiVsAIMode && this.input.activePointer.isDown) {
			if (canFire(this.player.lastAttackTime, now)) {
				this.player.lastAttackTime = now;
				const bx = this.playerPhys.x + PLAYER_WIDTH / 2;
				const by = this.playerPhys.y + PLAYER_HEIGHT / 2;
				this.fireLocalBullet(bx, by, this.cachedAimAngle, "player");
			}
		}

		if (this.aiEnemy && this.aiEnemy.hp > 0) {
			const output = this.aiEnemy.lastAIOutput;
			if (output.attack && canFire(this.aiEnemy.lastAttackTime, now)) {
				this.aiEnemy.lastAttackTime = now;
				this.fireLocalBullet(
					this.enemyPhys.x + PLAYER_WIDTH / 2,
					this.enemyPhys.y + PLAYER_HEIGHT / 2,
					output.aimAngle,
					"enemy",
				);
			}
		}

		if (this.aiVsAIMode && this.player && this.playerBrain && this.aiEnemy) {
			if (this.cachedPlayerAttack && canFire(this.player.lastAttackTime, now)) {
				this.player.lastAttackTime = now;
				this.fireLocalBullet(
					this.playerPhys.x + PLAYER_WIDTH / 2,
					this.playerPhys.y + PLAYER_HEIGHT / 2,
					this.cachedAimAngle,
					"player",
				);
			}
		}

		this.updateBulletCollisions();
	}

	private updateBulletCollisions() {
		for (let i = this.localBulletData.length - 1; i >= 0; i--) {
			const b = this.localBulletData[i];
			if (!b.active) {
				b.sprite.setVisible(false);
				this.localBulletData.splice(i, 1);
				continue;
			}

			if (isBulletOutOfBounds(b) || bulletHitsPlatform(b)) {
				b.sprite.setVisible(false);
				this.localBulletData.splice(i, 1);
				continue;
			}

			if (b.ownerId === "player" && this.aiEnemy && this.aiEnemy.hp > 0) {
				if (bulletHitsPlayer(b, this.enemyPhys.x, this.enemyPhys.y)) {
					this.onPlayerBulletHitEnemy(b);
					b.sprite.setVisible(false);
					this.localBulletData.splice(i, 1);
					continue;
				}
			}

			if (b.ownerId === "enemy" && this.player && this.player.hp > 0) {
				if (bulletHitsPlayer(b, this.playerPhys.x, this.playerPhys.y)) {
					this.onEnemyBulletHitPlayer(b);
					b.sprite.setVisible(false);
					this.localBulletData.splice(i, 1);
					continue;
				}
			}

			b.sprite.setPosition(b.x, b.y);
		}
	}

	private applyWorldBounds(pos: PlayerPosition) {
		if (pos.x < WORLD_LEFT) pos.x = WORLD_LEFT;
		if (pos.x + PLAYER_WIDTH > WORLD_RIGHT) pos.x = WORLD_RIGHT - PLAYER_WIDTH;
		if (pos.y + PLAYER_HEIGHT > WORLD_BOTTOM) {
			pos.y = WORLD_BOTTOM - PLAYER_HEIGHT;
			pos.vy = 0;
			pos.grounded = true;
		}
	}

	private applyPlatformCollision(pos: PlayerPosition, dt: number) {
		if (pos.vy < 0) return;
		for (const p of sharedPlatforms) {
			if (
				pos.x + PLAYER_WIDTH > p.x &&
				pos.x < p.x + p.w &&
				pos.y + PLAYER_HEIGHT <= p.y + 8 &&
				pos.y + PLAYER_HEIGHT + pos.vy * dt >= p.y
			) {
				pos.y = p.y - PLAYER_HEIGHT;
				pos.vy = 0;
				pos.grounded = true;
			}
		}
	}

	private getBulletSprite(): Phaser.GameObjects.Sprite {
		for (const s of this.bulletPool) {
			if (!s.visible) {
				s.setVisible(true);
				return s;
			}
		}
		const s = this.add.sprite(0, 0, "fireball");
		s.setOrigin(0.5);
		this.bulletPool.push(s);
		return s;
	}

	private fireLocalBullet(x: number, y: number, angle: number, owner: "player" | "enemy") {
		const id = this.nextBulletId++;
		const vx = Math.cos(angle) * 600;
		const vy = Math.sin(angle) * 600;
		const sprite = this.getBulletSprite();
		sprite.setPosition(x, y);
		const b: LocalBullet = { id, ownerId: owner, x, y, vx, vy, active: true, sprite };
		this.localBulletData.push(b);

		console.log(`Bullet [${owner}] -> fire -> angle ${angle.toFixed(3)}`);
		EventBus.emit("bullet-fired");
	}

	private updateCamera(dtSec: number) {
		const targetX = this.playerPhys.x + PLAYER_WIDTH / 2;
		const targetY = this.playerPhys.y + PLAYER_HEIGHT / 2;
		this.cameras.main.centerOn(
			targetX,
			targetY,
		);
	}

	// =============================================
	//  ONLINE MODE
	// =============================================

	updateOnline(t: number, dt: number, dtSec: number) {
		if (!this.player || !this.onlineManager?.connected) return;

		if (this.onlineAIMode && this.playerBrain && this.remoteSprite) {
			this.updateOnlineAI(t, dt, dtSec);
			return;
		}

		const left = this.cursors.left?.isDown ?? false;
		const right = this.cursors.right?.isDown ?? false;
		const up = this.cursors.up?.isDown ?? false;
		const attack = this.input.activePointer?.isDown ?? false;
		const aimAngle = this.player.getMouseAngle?.() ?? 0;

		this.onlineManager.sendInput({ left, right, up, attack, aimAngle });

		this.cachedPlayerInput = { left, right, up };

		this._diagPhysicsSteps = 0;
		this.physicsAccumulator += dtSec;
		let steps = 0;
		while (this.physicsAccumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
			this.playerPhys = tickPlayer(this.playerPhys, this.cachedPlayerInput, PHYSICS_DT);
			this.physicsAccumulator -= PHYSICS_DT;
			steps++;
		}
		if (this._diagActive) this._diagPhysicsSteps = steps;

		this.player.setPosition(this.playerPhys.x, this.playerPhys.y);
		this.player.grounded = this.playerPhys.grounded;

		if (left) {
			this.player.anims.play("left", true);
		} else if (right) {
			this.player.anims.play("right", true);
		} else {
			this.player.decideIdle();
		}

		this.updateRemoteInterpolation(dtSec);

		this.updateCamera(dtSec);
	}

	private updateRemoteInterpolation(dtSec: number) {
		if (!this.remoteSprite) return;
		this.remoteSprite.x = friLerp(this.remoteSprite.x, this.remoteTargetX, 0.8, dtSec);
		this.remoteSprite.y = friLerp(this.remoteSprite.y, this.remoteTargetY, 0.8, dtSec);
	}

	private updateOnlineAI(t: number, dt: number, dtSec: number) {
		if (!this.player || !this.playerBrain || !this.remoteSprite || !this.onlineManager) return;
		const brain = this.playerBrain;
		const enemyX = this.remoteSprite.x;
		const enemyY = this.remoteSprite.y;

		const dx = enemyX - this.player.x;
		const dy = enemyY - this.player.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const los = this.hasLineOfSight(this.player.x, this.player.y, enemyX, enemyY);

		const pInput = {
			playerX: enemyX,
			playerY: enemyY,
			selfX: this.player.x,
			selfY: this.player.y,
			distanceToPlayer: distance,
			playerFacingDirection: enemyX < this.player.x ? -1 : 1,
			touchingDown: this.playerPhys.grounded,
			touchingLeft: this.playerPhys.wallTouch === "left",
			touchingRight: this.playerPhys.wallTouch === "right",
			hasLineOfSight: los,
			selfHP: this.player.hp,
			enemyHP: this.remoteHp,
		};

		const output = brain.decide(pInput, t, dt);

		this.onlineManager.sendInput({
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
			attack: output.attack,
			aimAngle: output.aimAngle,
		});

		this.cachedPlayerInput = {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		};

		this._diagPhysicsSteps = 0;
		this.physicsAccumulator += dtSec;
		let steps = 0;
		while (this.physicsAccumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
			this.playerPhys = tickPlayer(this.playerPhys, this.cachedPlayerInput, PHYSICS_DT);
			this.physicsAccumulator -= PHYSICS_DT;
			steps++;
		}
		if (this._diagActive) this._diagPhysicsSteps = steps;

		this.player.setPosition(this.playerPhys.x, this.playerPhys.y);
		this.player.grounded = this.playerPhys.grounded;

		this.updateRemoteInterpolation(dtSec);

		this.updateCamera(dtSec);
	}

	// =============================================
	//  DIAGNOSTIC TOOL
	// =============================================

	private startDiagnostic(durationMs: number): string {
		if (this._diagActive) {
			return "DIAGNOSTIC_ALREADY_RUNNING";
		}

		this._diagActive = true;
		this._diagStartTime = performance.now();
		this._diagDuration = durationMs;
		this._diagFrames = [];
		this._diagPrev = {
			px: this.playerPhys.x,
			py: this.playerPhys.y,
			ex: this.enemyPhys.x,
			ey: this.enemyPhys.y,
			cx: this.cameras.main.scrollX,
			cy: this.cameras.main.scrollY,
		};
		this._diagFrameCount = 0;
		this._diagJitter = [];
		this._diagRecon = [];

		setTimeout(() => {
			const report = this.finishDiagnostic();
			console.log("__DIAGNOSTIC_RESULT__" + JSON.stringify(report) + "__END__");
		}, durationMs);

		return `DIAGNOSTIC_STARTED: ${durationMs}ms`;
	}

	private finishDiagnostic(): object {
		this._diagActive = false;

		const frames = this._diagFrames;
		const totalFrames = frames.length;
		if (totalFrames === 0) {
			return { error: "no_frames_collected" };
		}

		const dtValues = frames.map((f) => f.dt);
		const dtSum = dtValues.reduce((a, b) => a + b, 0);
		const dtMean = dtSum / dtValues.length;
		const dtVariance = dtValues.reduce((sum, d) => sum + (d - dtMean) ** 2, 0) / dtValues.length;
		const dtStdDev = Math.sqrt(dtVariance);
		const fpsValues = dtValues.map((d) => (d > 0 ? 1000 / d : 0));

		const totalDist = this.computeTotalDistance(frames);

		const byType: Record<string, number> = {};
		for (const j of this._diagJitter) {
			byType[j.type] = (byType[j.type] || 0) + 1;
		}
		const sevSum = this._diagJitter.reduce((s, j) => s + j.severity, 0);
		const sevMax = this._diagJitter.reduce((m, j) => Math.max(m, j.severity), 0);

		const stepCounts = frames.map((f) => f.physicsSteps);
		const framesWith0Steps = stepCounts.filter((s) => s === 0).length;
		const framesWith1Step = stepCounts.filter((s) => s === 1).length;
		const framesWith2Steps = stepCounts.filter((s) => s === 2).length;

		const report = {
			mode: this.onlineMode ? "online" : "offline",
			durationMs: this._diagDuration,
			totalFrames,
			fpsStats: {
				minFps: Math.round(Math.min(...fpsValues)),
				maxFps: Math.round(Math.max(...fpsValues)),
				avgFps: Math.round(1000 / dtMean),
				avgDtMs: Math.round(dtMean * 100) / 100,
				dtStdDevMs: Math.round(dtStdDev * 100) / 100,
			},
			physicsStepDistribution: {
				zeroStepFrames: framesWith0Steps,
				oneStepFrames: framesWith1Step,
				twoStepFrames: framesWith2Steps,
				pctZeroStep: totalFrames > 0 ? Math.round(framesWith0Steps / totalFrames * 100) : 0,
			},
			playerMovement: {
				xRange: [
					Math.round(Math.min(...frames.map((f) => f.playerX))),
					Math.round(Math.max(...frames.map((f) => f.playerX))),
				],
				yRange: [
					Math.round(Math.min(...frames.map((f) => f.playerY))),
					Math.round(Math.max(...frames.map((f) => f.playerY))),
				],
				totalTravelPx: Math.round(totalDist),
			},
			jitterEvents: this._diagJitter,
			jitterSummary: {
				total: this._diagJitter.length,
				avgSeverity: this._diagJitter.length > 0 ? Math.round(sevSum / this._diagJitter.length * 100) / 100 : 0,
				maxSeverity: Math.round(sevMax * 100) / 100,
				byType,
			},
			reconciliationEvents: this._diagRecon.length > 0 ? this._diagRecon : undefined,
			reconciliationSummary: this._diagRecon.length > 0 ? this.computeReconSummary() : undefined,
			verdict: this._diagJitter.length === 0 ? "PASS: No jitter detected" : `FAIL: ${this._diagJitter.length} jitter events detected`,
		};

		return report;
	}

	private computeTotalDistance(frames: DiagnosticFrame[]): number {
		let dist = 0;
		for (let i = 1; i < frames.length; i++) {
			const dx = frames[i].playerX - frames[i - 1].playerX;
			const dy = frames[i].playerY - frames[i - 1].playerY;
			dist += Math.sqrt(dx * dx + dy * dy);
		}
		return dist;
	}

	private computeReconSummary() {
		if (this._diagRecon.length === 0) return undefined;
		const corrections = this._diagRecon.map((r) => r.correction);
		return {
			totalCorrections: this._diagRecon.length,
			avgErrorPx: Math.round(corrections.reduce((a, b) => a + b, 0) / corrections.length * 100) / 100,
			maxErrorPx: Math.round(Math.max(...corrections) * 100) / 100,
			cumulativeDriftPx: Math.round(corrections.reduce((a, b) => a + b, 0) * 100) / 100,
		};
	}

	private recordDiagnosticFrame(t: number, dt: number) {
		if (!this._diagActive) return;

		this._diagFrameCount++;

		const frame: DiagnosticFrame = {
			playerX: this.playerPhys.x,
			playerY: this.playerPhys.y,
			playerVx: this.playerPhys.vx,
			playerVy: this.playerPhys.vy,
			enemyX: this.enemyPhys.x,
			enemyY: this.enemyPhys.y,
			enemyVx: this.enemyPhys.vx,
			enemyVy: this.enemyPhys.vy,
			cameraX: this.cameras.main.scrollX,
			cameraY: this.cameras.main.scrollY,
			t,
			dt,
			physicsSteps: this._diagPhysicsSteps,
		};
		this._diagFrames.push(frame);

		if (this._diagSkipJitter) {
			this._diagSkipJitter = false;
			this._diagPrev = {
				px: frame.playerX,
				py: frame.playerY,
				ex: frame.enemyX,
				ey: frame.enemyY,
				cx: frame.cameraX,
				cy: frame.cameraY,
			};
			return;
		}

		const prev = this._diagPrev;

		const checkJitter = (label: string, current: number, prev: number, threshold: number) => {
			const delta = Math.abs(current - prev);
			if (delta > threshold) {
				this._diagJitter.push({
					frame: this._diagFrameCount,
					type: label,
					delta: Math.round(delta * 100) / 100,
					expectedMax: threshold,
					severity: Math.round(delta / threshold * 100) / 100,
				});
			}
		};

		checkJitter("player_x", frame.playerX, prev.px, DIAG_JITTER_X);
		checkJitter("player_y", frame.playerY, prev.py, DIAG_JITTER_Y);
		checkJitter("enemy_x", frame.enemyX, prev.ex, DIAG_JITTER_X);
		checkJitter("enemy_y", frame.enemyY, prev.ey, DIAG_JITTER_Y);
		checkJitter("camera_x", frame.cameraX, prev.cx, DIAG_JITTER_CAM);
		checkJitter("camera_y", frame.cameraY, prev.cy, DIAG_JITTER_CAM);

		this._diagPrev = {
			px: frame.playerX,
			py: frame.playerY,
			ex: frame.enemyX,
			ey: frame.enemyY,
			cx: frame.cameraX,
			cy: frame.cameraY,
		};
	}

	private logAIVsAIState() {
		if (!this.aiVsAIMode || !this.player || !this.aiEnemy) return;
		console.log(
			`[STATE] Player: ${this.playerBrain?.getCurrentState()} | Enemy: ${this.aiEnemy.getCurrentAIState()} | HP ${this.player.hp} vs ${this.aiEnemy.hp}`,
		);
	}
}
