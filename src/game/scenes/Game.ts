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
import type { BulletData } from "../skills/Bullets";
import { MovementState, ActionState } from "../characters/playerStates";

interface LocalBullet extends BulletState {
	active: boolean;
	sprite: Phaser.GameObjects.Sprite;
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

	constructor() {
		super("Game");
	}

	preload() {}

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

				this.playerPhys.x += (p.x - this.playerPhys.x) * 0.15;
				this.playerPhys.y += (p.y - this.playerPhys.y) * 0.15;
				this.player.setPosition(this.playerPhys.x, this.playerPhys.y);

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

	update(t: number, dt: number) {
		if (this.onlineMode) {
			this.updateOnline(t, dt);
			return;
		}

		const dtSec = dt / 1000;

		if (this.aiVsAIMode && this.player && this.playerBrain && this.aiEnemy) {
			this.updateAIVsAI(t, dtSec);
		} else {
			this.updateLocalPlayer(dtSec);
		}

		this.updateAISimulation(t, dtSec);

		this.updateBullets(dtSec);

		this.cameras.main.centerOn(
			this.playerPhys.x + PLAYER_WIDTH / 2,
			this.playerPhys.y + PLAYER_HEIGHT / 2,
		);
	}

	private updateLocalPlayer(dtSec: number) {
		if (!this.player || !this.cursors) return;

		this.player.update(this.game.loop.time, dtSec * 1000, this.cursors);

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

		this.playerPhys = tickPlayer(this.playerPhys, input, dtSec);
		this.player.setPosition(this.playerPhys.x, this.playerPhys.y);
		this.player.grounded = this.playerPhys.grounded;

		if (this.input.activePointer.isDown) {
			const now = this.game.loop.time;
			if (canFire(this.player.lastAttackTime, now)) {
				this.player.lastAttackTime = now;
				const bx = this.playerPhys.x + PLAYER_WIDTH / 2;
				const by = this.playerPhys.y + PLAYER_HEIGHT / 2;
				this.fireLocalBullet(bx, by, this.player.getMouseAngle(), "player");
			}
		}
	}

	private updateAISimulation(t: number, dtSec: number) {
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

		if (output.evadeActive) {
			const dir = output.moveLeft ? -1 : 1;
			this.enemyPhys.vx = dir * 300;
			this.enemyPhys.vy += 300 * dtSec;
			this.enemyPhys.x += this.enemyPhys.vx * dtSec;
			this.enemyPhys.y += this.enemyPhys.vy * dtSec;
			this.applyWorldBounds(this.enemyPhys);
			this.applyPlatformCollision(this.enemyPhys, dtSec);
		} else {
			this.enemyPhys = tickPlayer(this.enemyPhys, {
				left: output.moveLeft,
				right: output.moveRight,
				up: output.jump,
			}, dtSec);
		}

		this.aiEnemy.setPosition(this.enemyPhys.x, this.enemyPhys.y);
		this.aiEnemy.grounded = this.enemyPhys.grounded;
		this.aiEnemy.lastFacingDirection = output.moveLeft ? -1 : output.moveRight ? 1 : this.aiEnemy.lastFacingDirection;

		const now = this.game.loop.time;
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

	private updateBullets(dtSec: number) {
		for (let i = this.localBulletData.length - 1; i >= 0; i--) {
			const b = this.localBulletData[i];
			if (!b.active) {
				b.sprite.setVisible(false);
				this.localBulletData.splice(i, 1);
				continue;
			}

			tickBullet(b, dtSec);

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

	private logAIVsAIState() {
		if (!this.aiVsAIMode || !this.player || !this.aiEnemy) return;
		console.log(
			`[STATE] Player: ${this.playerBrain?.getCurrentState()} | Enemy: ${this.aiEnemy.getCurrentAIState()} | HP ${this.player.hp} vs ${this.aiEnemy.hp}`,
		);
	}

	updateOnline(t: number, dt: number) {
		if (!this.player || !this.onlineManager?.connected) return;

		if (this.onlineAIMode && this.playerBrain && this.remoteSprite) {
			this.updateOnlineAI(t, dt);
			return;
		}

		const left = this.cursors.left?.isDown ?? false;
		const right = this.cursors.right?.isDown ?? false;
		const up = this.cursors.up?.isDown ?? false;
		const attack = this.input.activePointer?.isDown ?? false;
		const aimAngle = this.player.getMouseAngle?.() ?? 0;

		this.onlineManager.sendInput({ left, right, up, attack, aimAngle });

		const dtSec = dt / 1000;
		this.playerPhys = tickPlayer(this.playerPhys, { left, right, up }, dtSec);
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

		this.cameras.main.centerOn(
			this.playerPhys.x + PLAYER_WIDTH / 2,
			this.playerPhys.y + PLAYER_HEIGHT / 2,
		);
	}

	private updateRemoteInterpolation(dtSec: number) {
		if (!this.remoteSprite) return;
		const lerpSpeed = 12;
		this.remoteSprite.x += (this.remoteTargetX - this.remoteSprite.x) * lerpSpeed * dtSec;
		this.remoteSprite.y += (this.remoteTargetY - this.remoteSprite.y) * lerpSpeed * dtSec;
	}

	private updateOnlineAI(t: number, dt: number) {
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

		const dtSec = dt / 1000;
		this.playerPhys = tickPlayer(this.playerPhys, {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		}, dtSec);
		this.player.setPosition(this.playerPhys.x, this.playerPhys.y);
		this.player.grounded = this.playerPhys.grounded;

		this.updateRemoteInterpolation(dtSec);

		this.cameras.main.centerOn(
			this.playerPhys.x + PLAYER_WIDTH / 2,
			this.playerPhys.y + PLAYER_HEIGHT / 2,
		);
	}

	private updateAIVsAI(t: number, dtSec: number) {
		const player = this.player!;
		const enemy = this.aiEnemy!;
		const brain = this.playerBrain!;

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

		const output = brain.decide(pInput, t, dtSec * 1000);
		player.setAIOverride(output);

		this.playerPhys = tickPlayer(this.playerPhys, {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		}, dtSec);
		player.setPosition(this.playerPhys.x, this.playerPhys.y);
		player.grounded = this.playerPhys.grounded;

		const now = this.game.loop.time;
		if (output.attack && canFire(player.lastAttackTime, now)) {
			player.lastAttackTime = now;
			this.fireLocalBullet(
				this.playerPhys.x + PLAYER_WIDTH / 2,
				this.playerPhys.y + PLAYER_HEIGHT / 2,
				output.aimAngle,
				"player",
			);
		}
	}
}
