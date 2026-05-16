import type { ServerChannel } from "@geckos.io/server";
import {
	BULLET_DAMAGE,
	BULLET_SPEED,
	type BulletState,
	bulletHitsPlatform,
	bulletHitsPlayer,
	canFire,
	isBulletOutOfBounds,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerPosition,
	tickBullet,
	tickPlayer,
} from "./physics.js";

export interface PlayerInput {
	left: boolean;
	right: boolean;
	up: boolean;
	attack: boolean;
	aimAngle: number;
}

interface ConnectedPlayer {
	channel: ServerChannel;
	x: number;
	y: number;
	vx: number;
	vy: number;
	hp: number;
	facingDir: number;
	grounded: boolean;
	lastAttackTime: number;
}

export interface SnapshotPlayer {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	hp: number;
	facingDir: number;
}

export interface SnapshotBullet {
	id: number;
	ownerId: string;
	x: number;
	y: number;
}

const START_X_A = 100;
const START_X_B = 700;
const START_Y = 500;

const MAX_PLAYERS = 2;
const TICK_RATE = 1000 / 60;
const BROADCAST_RATE = 1000 / 20;

export class GameRoom {
	readonly id: string;
	private players = new Map<string, ConnectedPlayer>();
	private bullets: BulletState[] = [];
	private nextBulletId = 0;
	private channelIds: string[] = [];
	private inputBuffer = new Map<string, PlayerInput>();
	private tickAccumulator = 0;
	private broadcastAccumulator = 0;
	private lastTime = 0;
	private resetTimer: number = -1;

	constructor(id: string) {
		this.id = id;
	}

	get playerCount(): number {
		return this.channelIds.length;
	}

	get isFull(): boolean {
		return this.channelIds.length >= MAX_PLAYERS;
	}

	addPlayer(channel: ServerChannel): boolean {
		if (this.isFull) return false;

		const isFirst = this.channelIds.length === 0;
		const id = channel.id as string;
		this.channelIds.push(id);
		this.players.set(id, {
			channel,
			x: isFirst ? START_X_A : START_X_B,
			y: START_Y,
			vx: 0,
			vy: 0,
			hp: 100,
			facingDir: isFirst ? 1 : -1,
			grounded: false,
			lastAttackTime: 0,
		});
		this.inputBuffer.set(id, {
			left: false,
			right: false,
			up: false,
			attack: false,
			aimAngle: 0,
		});

		channel.join(this.id);
		channel.userData = { roomId: this.id };

		channel.on("input", (data: unknown) => {
			const input = data as PlayerInput;
			this.inputBuffer.set(id, input);
		});

		channel.onDisconnect(() => {
			this.removePlayer(id);
		});

		return true;
	}

	private removePlayer(id: string) {
		this.players.delete(id);
		this.inputBuffer.delete(id);
		this.channelIds = this.channelIds.filter((c) => c !== id);
		const channel = [...this.players.values()].find((p) => p.channel.id === id);
		if (channel) channel.channel.leave();
	}

	get snapshot(): { players: SnapshotPlayer[]; bullets: SnapshotBullet[] } {
		const playerArr: SnapshotPlayer[] = [];
		for (const [id, p] of this.players) {
			playerArr.push({
				id,
				x: p.x,
				y: p.y,
				vx: p.vx,
				vy: p.vy,
				hp: p.hp,
				facingDir: p.facingDir,
			});
		}
		return {
			players: playerArr,
			bullets: this.bullets.map((b) => ({
				id: b.id,
				ownerId: b.ownerId,
				x: b.x,
				y: b.y,
			})),
		};
	}

	tick(time: number) {
		if (this.lastTime === 0) this.lastTime = time;
		const elapsed = time - this.lastTime;
		this.lastTime = time;
		this.tickAccumulator += elapsed;
		this.broadcastAccumulator += elapsed;

		while (this.tickAccumulator >= TICK_RATE) {
			this.fixedTick(TICK_RATE / 1000, time);
			this.tickAccumulator -= TICK_RATE;
		}

		if (this.broadcastAccumulator >= BROADCAST_RATE) {
			this.broadcastAccumulator = 0;
			this.broadcastState();
		}
	}

	private fixedTick(dt: number, now: number) {
		for (const [id, player] of this.players) {
			const input = this.inputBuffer.get(id) ?? {
				left: false,
				right: false,
				up: false,
				attack: false,
				aimAngle: 0,
			};

			const pos: PlayerPosition = {
				x: player.x,
				y: player.y,
				vx: player.vx,
				vy: player.vy,
				grounded: player.grounded,
				wallTouch: "none",
				wallJumpTimer: 0,
			};
			const result = tickPlayer(pos, input, dt);
			player.x = result.x;
			player.y = result.y;
			player.vx = result.vx;
			player.vy = result.vy;
			player.grounded = result.grounded;

			if (input.attack && canFire(player.lastAttackTime, now)) {
				player.lastAttackTime = now;
				const bx = player.x + PLAYER_WIDTH / 2;
				const by = player.y + PLAYER_HEIGHT / 2;
				const bvx = Math.cos(input.aimAngle) * BULLET_SPEED;
				const bvy = Math.sin(input.aimAngle) * BULLET_SPEED;
				this.bullets.push({
					id: this.nextBulletId++,
					ownerId: id,
					x: bx,
					y: by,
					vx: bvx,
					vy: bvy,
				});
			}
		}

		for (let i = this.bullets.length - 1; i >= 0; i--) {
			const b = this.bullets[i];
			tickBullet(b, dt);

			if (isBulletOutOfBounds(b) || bulletHitsPlatform(b)) {
				this.bullets.splice(i, 1);
				continue;
			}

			let hit = false;
			for (const [id, player] of this.players) {
				if (b.ownerId === id) continue;
				if (bulletHitsPlayer(b, player.x, player.y)) {
					player.hp -= BULLET_DAMAGE;
					if (player.hp < 0) player.hp = 0;
					hit = true;
					break;
				}
			}
			if (hit) {
				this.bullets.splice(i, 1);
			}
		}

		for (const [, player] of this.players) {
			const inp = this.inputBuffer.get(player.channel.id as string) ?? {
				left: false,
				right: false,
				up: false,
				attack: false,
				aimAngle: 0,
			};
			if (inp.left) player.facingDir = -1;
			else if (inp.right) player.facingDir = 1;
		}

		if (this.resetTimer > 0) {
			this.resetTimer -= dt * 1000;
			if (this.resetTimer <= 0) {
				this.resetPlayers();
			}
			return;
		}

		for (const [, player] of this.players) {
			if (player.hp <= 0) {
				this.resetTimer = 1500;
				break;
			}
		}
	}

	private resetPlayers() {
		const ids = this.channelIds;
		if (ids.length === 0) return;
		for (let i = 0; i < ids.length; i++) {
			const p = this.players.get(ids[i]);
			if (!p) continue;
			p.x = i === 0 ? START_X_A : START_X_B;
			p.y = START_Y;
			p.vx = 0;
			p.vy = 0;
			p.hp = 100;
			p.grounded = false;
			p.lastAttackTime = 0;
		}
		this.bullets = [];
		this.resetTimer = -1;
	}

	broadcast(event: string, data: object) {
		for (const player of this.players.values()) {
			player.channel.emit(event, data);
		}
	}

	private broadcastState() {
		const snap = this.snapshot;
		for (const player of this.players.values()) {
			player.channel.emit("state", snap);
		}
	}
}
