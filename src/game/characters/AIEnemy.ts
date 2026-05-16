import Phaser from "phaser";
import { ATTACK_COOLDOWN } from "../constants";
import { EventBus } from "../EventBus";
import Bullets from "../skills/Bullets";
import Melee from "../weapons/Melee";
import { type AIConfig, DEFAULT_AI_CONFIG } from "./AIConfig";
import EnemyBrain from "./EnemyBrain";
import { FacingState } from "./playerStates";

export default class AIEnemy extends Phaser.Physics.Arcade.Sprite {
	public bullets: Bullets;
	private brain: EnemyBrain;
	private melee?: Melee;
	private _hp = 100;
	lastFacingDirection = 1;
	private lastAttackTime = 0;
	private attackCooldown = ATTACK_COOLDOWN;
	private dodgeTimer = 0;
	private dodgeDirection = 0;

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
		scene.physics.add.existing(this);
		scene.sys.displayList.add(this);
		scene.sys.updateList.add(this);
		this.setBounce(0.4);
		this.setCollideWorldBounds(true);
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
	) {
		if (this._hp <= 0) {
			this.setVelocity(0, 0);
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
			touchingDown: this.body?.touching.down ?? false,
			touchingLeft: this.body?.touching.left ?? false,
			touchingRight: this.body?.touching.right ?? false,
			hasLineOfSight,
			selfHP: this._hp,
			enemyHP: playerHP,
		};

		if (this.dodgeTimer > 0) {
			this.setVelocityX(this.dodgeDirection * 300);
			this.lastFacingDirection = this.dodgeDirection;
			this.anims.play(this.dodgeDirection < 0 ? "left" : "right", true);
			return;
		}

		const output = this.brain.decide(input, time, delta);

		if (output.evadeActive) {
			this.dodgeTimer = 200 + Math.random() * 100;
			this.dodgeDirection = output.moveLeft ? -1 : 1;
			this.lastFacingDirection = this.dodgeDirection;
			this.setVelocityX(this.dodgeDirection * 300);
			this.anims.play(this.dodgeDirection < 0 ? "left" : "right", true);
			if (output.jump && this.body?.touching.down) {
				this.setVelocityY(-330);
			}
			return;
		}

		if (output.moveLeft && !output.moveRight) {
			this.setVelocityX(-160);
			this.lastFacingDirection = -1;
			this.anims.play("left", true);
		} else if (output.moveRight && !output.moveLeft) {
			this.setVelocityX(160);
			this.lastFacingDirection = 1;
			this.anims.play("right", true);
		} else {
			if (this.body?.touching.down) this.anims.play("turn");
			this.setVelocityX(0);
		}

		if (output.jump && this.body?.touching.down) {
			this.setVelocityY(-330);
		} else if (output.jump && this.body?.touching.left) {
			this.setVelocity(100, -330);
		} else if (output.jump && this.body?.touching.right) {
			this.setVelocity(-100, -330);
		}

		if (output.attack && time - this.lastAttackTime > this.attackCooldown) {
			this.lastAttackTime = time;
			const isMelee = distance < 100;
			if (isMelee) {
				this.meleeAttack();
			} else {
				this.bullets.fireBullet(this.body!.x, this.body!.y, output.aimAngle);
			}
		}
	}

	private meleeAttack() {
		const facing = this.decideFacing();
		this.melee = new Melee(this.scene, facing, this.x, this.y);
	}
}
