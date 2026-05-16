export const GRAVITY = 300;
export const PLAYER_WALK_SPEED = 160;
export const JUMP_VELOCITY = -330;
export const BULLET_SPEED = 600;
export const WORLD_LEFT = 0;
export const WORLD_RIGHT = 800;
export const WORLD_TOP = 0;
export const WORLD_BOTTOM = 600;
export const ATTACK_COOLDOWN = 250;
export const BULLET_DAMAGE = 10;
export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 48;
export const WALL_JUMP_HORIZONTAL = 100;
export const WALL_JUMP_VERTICAL = -100;
export const WALL_JUMP_LOCKOUT = 700;

export interface Platform {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const platforms: Platform[] = [
	{ x: 0, y: 568, w: 800, h: 32 },
	{ x: 40, y: 250, w: 100, h: 32 },
	{ x: 700, y: 220, w: 100, h: 32 },
	{ x: 550, y: 400, w: 100, h: 32 },
];

export interface PlayerPosition {
	x: number;
	y: number;
	vx: number;
	vy: number;
	grounded: boolean;
	wallTouch: "none" | "left" | "right";
	wallJumpTimer: number;
}

export function tickPlayer(
	pos: PlayerPosition,
	input: { left: boolean; right: boolean; up: boolean },
	dt: number,
): PlayerPosition {
	let { x, y, vx, vy, grounded, wallTouch, wallJumpTimer } = pos;

	vy += GRAVITY * dt;

	if (wallJumpTimer > 0) {
		wallJumpTimer = Math.max(0, wallJumpTimer - dt * 1000);
		vx *= 0.85;
	} else {
		if (input.left) vx = -PLAYER_WALK_SPEED;
		else if (input.right) vx = PLAYER_WALK_SPEED;
		else vx *= 0.85;
	}

	const wantsJump = input.up;
	let performedGroundJump = false;

	if (wantsJump && grounded) {
		vy = JUMP_VELOCITY;
		grounded = false;
		performedGroundJump = true;
	}

	x += vx * dt;
	y += vy * dt;

	if (x < WORLD_LEFT) x = WORLD_LEFT;
	if (x + PLAYER_WIDTH > WORLD_RIGHT) x = WORLD_RIGHT - PLAYER_WIDTH;

	grounded = false;
	wallTouch = "none";
	for (const p of platforms) {
		if (
			x + PLAYER_WIDTH > p.x &&
			x < p.x + p.w &&
			vy >= 0 &&
			y + PLAYER_HEIGHT <= p.y + 8 &&
			y + PLAYER_HEIGHT + vy * dt >= p.y
		) {
			y = p.y - PLAYER_HEIGHT;
			vy = 0;
			grounded = true;
		}

		if (!grounded && !performedGroundJump) {
			if (
				y + PLAYER_HEIGHT > p.y &&
				y < p.y + p.h
			) {
				if (vx > 0 && x + PLAYER_WIDTH > p.x - 4 && x < p.x + 4) {
					x = p.x - PLAYER_WIDTH;
					vx = 0;
					wallTouch = "right";
				} else if (vx < 0 && x < p.x + p.w + 4 && x + PLAYER_WIDTH > p.x + p.w - 4) {
					const wallX = p.x + p.w;
					if (wallX + PLAYER_WIDTH <= WORLD_RIGHT && wallX >= WORLD_LEFT) {
						x = wallX;
						vx = 0;
						wallTouch = "left";
					}
				}
			}
		}
	}

	if (!grounded && wallTouch === "none") {
		for (const p of platforms) {
			const insideLeft = x + PLAYER_WIDTH > p.x + 4;
			const insideRight = x < p.x + p.w - 4;
			const insideTop = y + PLAYER_HEIGHT > p.y + 4;
			const insideBottom = y < p.y + p.h - 4;
			if (insideLeft && insideRight && insideTop && insideBottom) {
				const dLeft = x - p.x + PLAYER_WIDTH;
				const dRight = p.x + p.w - x;
				const dTop = y - p.y + PLAYER_HEIGHT;
				const dBot = p.y + p.h - y;
				const minD = Math.min(dLeft, dRight, dTop, dBot);
				if (minD === dLeft) {
					x = p.x - PLAYER_WIDTH;
					vx = 0;
				} else if (minD === dRight) {
					const nx = p.x + p.w;
					if (nx + PLAYER_WIDTH <= WORLD_RIGHT && nx >= WORLD_LEFT) {
						x = nx;
					} else {
						x = p.x - PLAYER_WIDTH;
					}
					vx = 0;
				} else if (minD === dTop) {
					y = p.y - PLAYER_HEIGHT;
					vy = 0;
					grounded = true;
				} else {
					y = p.y + p.h;
					vy = 0;
				}
				break;
			}
		}
	}

	if (wantsJump && !grounded && wallTouch !== "none" && wallJumpTimer <= 0) {
		const dir = wallTouch === "left" ? 1 : -1;
		vx = dir * WALL_JUMP_HORIZONTAL;
		vy = WALL_JUMP_VERTICAL;
		wallTouch = "none";
		wallJumpTimer = WALL_JUMP_LOCKOUT;
	}

	if (y + PLAYER_HEIGHT > WORLD_BOTTOM) {
		y = WORLD_BOTTOM - PLAYER_HEIGHT;
		vy = 0;
		grounded = true;
	}

	return { x, y, vx, vy, grounded, wallTouch, wallJumpTimer };
}

export function canFire(lastAttackTime: number, now: number): boolean {
	return now - lastAttackTime >= ATTACK_COOLDOWN;
}

export interface BulletState {
	id: number;
	ownerId: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

export function tickBullet(b: BulletState, dt: number): void {
	b.x += b.vx * dt;
	b.y += b.vy * dt;
}

export function isBulletOutOfBounds(b: BulletState): boolean {
	return b.x < -50 || b.x > 850 || b.y < -50 || b.y > 650;
}

export function bulletHitsPlayer(
	b: BulletState,
	px: number,
	py: number,
): boolean {
	const margin = 12;
	return (
		b.x > px - margin &&
		b.x < px + PLAYER_WIDTH + margin &&
		b.y > py - margin &&
		b.y < py + PLAYER_HEIGHT + margin
	);
}

export function bulletHitsPlatform(b: BulletState): boolean {
	for (const p of platforms) {
		if (b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h) {
			return true;
		}
	}
	return false;
}
