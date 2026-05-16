import Phaser from "phaser";
import { EventBus } from "../EventBus";
import Bullets from "../skills/Bullets";
import Melee from "../weapons/Melee";
import { type AIConfig, DEFAULT_AI_CONFIG } from "./AIConfig";
import EnemyBrain, { type AIOutput } from "./EnemyBrain";
import { FacingState } from "./playerStates";

export default class AIEnemy extends Phaser.GameObjects.Sprite {
	public bullets: Bullets;
	private brain: EnemyBrain;
	private melee?: Melee;
	private _hp = 100;
	lastFacingDirection = 1;
	lastAttackTime = 0;
	private dodgeTimer = 0;
	private dodgeDirection = 0;
	grounded = false;
	lastAIOutput: AIOutput = {
		moveLeft: false, moveRight: false, jump: false, attack: false,
		aimAngle: 0, evadeActive: false, switchToMelee: false, switchToRanged: true,
	};

	public get hp() {
		return this._hp;
	}

	public set hp(value: number) {
		this._hp = value;
	}

	public get brainConfig() {
		return this.brain.getConfig();
	}

	constructor(
		scene: Phaser.Scene,
		x: number,
		y: number,
		texture: string,
		config?: Partial<AIConfig>,
		frame?: string | number,
	) {
		super(scene, x, y, texture, frame);
		scene.sys.displayList.add(this);
		scene.sys.updateList.add(this);
		this.bullets = new Bullets(scene);
		this.bullets.setOwner("ENEMY");
		this.brain = new EnemyBrain({ ...DEFAULT_AI_CONFIG, ...config });
	}

	updateConfig(config: Partial<AIConfig>) {
		this.brain.updateConfig(config);
	}

	resetBrain() {
		this.brain.resetState();
	}

	takeDamage(amount: number) {
		this._hp -= amount;
		EventBus.emit("enemy-hp-changed", this._hp);
	}

	getCurrentAIState() {
		return this.brain.getCurrentState();
	}

	getFacingDirection(): number {
		const key = this.anims.currentAnim?.key;
		const dir = key === "left" ? -1 : 1;
		this.lastFacingDirection = dir;
		return dir;
	}

	private decideFacing(): FacingState {
		const currentKey = this.anims.currentAnim?.key;
		const direction = currentKey?.split("-")[0];
		return direction === "left" ? FacingState.LEFT : FacingState.RIGHT;
	}

	preUpdate(t: number, dt: number) {
		super.preUpdate(t, dt);
	}

	update(
		time: number,
		delta: number,
		playerX: number,
		playerY: number,
		playerFacingDirection: number,
		hasLineOfSight = true,
		playerHP = 100,
		wallTouch: "none" | "left" | "right" = "none",
	) {
		if (this._hp <= 0) {
			this.anims.play("turn");
			return;
		}

		this.melee?.updatePosition(this.x, this.y);
		this.dodgeTimer -= delta;

		const dx = playerX - this.x;
		const dy = playerY - this.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		const input = {
			playerX,
			playerY,
			selfX: this.x,
			selfY: this.y,
			distanceToPlayer: distance,
			playerFacingDirection,
			touchingDown: this.grounded,
			touchingLeft: wallTouch === "left",
			touchingRight: wallTouch === "right",
			hasLineOfSight,
			selfHP: this._hp,
			enemyHP: playerHP,
		};

		if (this.dodgeTimer > 0) {
			this.lastFacingDirection = this.dodgeDirection;
			this.anims.play(this.dodgeDirection < 0 ? "left" : "right", true);
			return;
		}

		const output = this.brain.decide(input, time, delta);
		this.lastAIOutput = output;

		if (output.evadeActive) {
			this.dodgeTimer = 200 + Math.random() * 100;
			this.dodgeDirection = output.moveLeft ? -1 : 1;
			this.lastFacingDirection = this.dodgeDirection;
			this.anims.play(this.dodgeDirection < 0 ? "left" : "right", true);
			return;
		}

		if (output.moveLeft && !output.moveRight) {
			this.lastFacingDirection = -1;
			this.anims.play("left", true);
		} else if (output.moveRight && !output.moveLeft) {
			this.lastFacingDirection = 1;
			this.anims.play("right", true);
		} else {
			if (this.grounded) this.anims.play("turn");
		}

		if (output.attack && time - this.lastAttackTime > 250) {
			this.lastAttackTime = time;
			const isMelee = distance < 100;
			if (isMelee) {
				this.meleeAttack();
			} else {
				this.bullets.fireBullet(this.x, this.y, output.aimAngle);
			}
		}
	}

	private meleeAttack() {
		const facing = this.decideFacing();
		this.melee = new Melee(this.scene, facing, this.x, this.y);
	}
}
