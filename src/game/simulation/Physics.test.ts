import { describe, it, expect } from "vitest";
import {
	tickPlayer,
	type PlayerPosition,
	platforms,
	GRAVITY,
	JUMP_VELOCITY,
	PLAYER_WIDTH,
	PLAYER_HEIGHT,
	WALL_JUMP_HORIZONTAL,
	WALL_JUMP_VERTICAL,
	WALL_JUMP_LOCKOUT,
	PLAYER_WALK_SPEED,
	WORLD_RIGHT,
} from "./Physics";

const DT = 1 / 60;
const GROUND_Y = 568;

function pos(overrides: Partial<PlayerPosition> = {}): PlayerPosition {
	return {
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		grounded: false,
		wallTouch: "none",
		wallJumpTimer: 0,
		...overrides,
	};
}

function tick(
	p: PlayerPosition,
	input: Partial<{ left: boolean; right: boolean; up: boolean }> = {},
	dt = DT,
): PlayerPosition {
	return tickPlayer(p, { left: false, right: false, up: false, ...input }, dt);
}

function ticks(
	p: PlayerPosition,
	input: Partial<{ left: boolean; right: boolean; up: boolean }> = {},
	n = 1,
): PlayerPosition {
	let result = p;
	for (let i = 0; i < n; i++) {
		result = tick(result, input);
	}
	return result;
}

describe("gravity & ground", () => {
	it("applies gravity each tick", () => {
		const r = tick(pos({ y: 100 }));
		expect(r.vy).toBe(GRAVITY * DT);
		expect(r.y).toBe(100 + r.vy * DT);
	});

	it("lands on the ground platform", () => {
		const p = pos({ y: GROUND_Y - PLAYER_HEIGHT - 1, vy: 300 });
		const r = tick(p);
		expect(r.grounded).toBe(true);
		expect(r.y).toBe(GROUND_Y - PLAYER_HEIGHT);
		expect(r.vy).toBe(0);
	});

	it("lands on a floating platform", () => {
		const plat = platforms[1];
		const p = pos({ x: plat.x + 10, y: plat.y - PLAYER_HEIGHT - 1, vy: 200 });
		const r = tick(p);
		expect(r.grounded).toBe(true);
		expect(r.y).toBe(plat.y - PLAYER_HEIGHT);
		expect(r.vy).toBe(0);
	});

	it("ground jump launches upward", () => {
		const p = pos({ grounded: true });
		const r = tick(p, { up: true });
		expect(r.vy).toBe(JUMP_VELOCITY);
		expect(r.grounded).toBe(false);
	});

	it("cannot jump when not grounded", () => {
		const p = pos({ vy: 100 });
		const r = tick(p, { up: true });
		expect(r.vy).toBe(100 + GRAVITY * DT);
	});
});

describe("wall collision detection", () => {
	const plat = platforms[1]; // { x: 40, y: 250, w: 100, h: 32 }
	const mid = platforms[3]; // { x: 550, y: 400, w: 100, h: 32 }

	it("stops player moving right into left face of platform", () => {
		const p = pos({
			x: plat.x - 8,
			y: plat.y,
			vx: PLAYER_WALK_SPEED,
			vy: 0,
		});
		const r = tick(p, { right: true });
		expect(r.x).toBe(plat.x - PLAYER_WIDTH);
		expect(r.vx).toBe(0);
		expect(r.wallTouch).toBe("right");
	});

	it("stops player moving left into right face of platform", () => {
		const p = pos({
			x: mid.x + mid.w + 2,
			y: mid.y,
			vx: -PLAYER_WALK_SPEED,
			vy: 0,
		});
		const r = tick(p, { left: true });
		expect(r.x).toBe(mid.x + mid.w);
		expect(r.vx).toBe(0);
		expect(r.wallTouch).toBe("left");
	});

	it("does not stick to wall when moving away", () => {
		const p = pos({
			x: plat.x - PLAYER_WIDTH,
			y: plat.y,
			vx: -PLAYER_WALK_SPEED,
			vy: 0,
		});
		const r = tick(p, { left: true });
		expect(r.wallTouch).toBe("none");
	});

	it("does not detect wall when stationary next to it", () => {
		const p = pos({
			x: plat.x - PLAYER_WIDTH,
			y: plat.y,
			vx: 0,
			vy: 0,
		});
		const r = tick(p);
		expect(r.wallTouch).toBe("none");
	});

	it("does not detect wall when player is below platform", () => {
		const p = pos({
			x: plat.x - 10,
			y: plat.y + plat.h,
			vx: PLAYER_WALK_SPEED,
		});
		const r = tick(p, { right: true });
		expect(r.wallTouch).toBe("none");
	});

	it("does not detect wall when player is above platform", () => {
		const p = pos({
			x: plat.x - 10,
			y: plat.y - PLAYER_HEIGHT - 10,
			vx: PLAYER_WALK_SPEED,
		});
		const r = tick(p, { right: true });
		expect(r.wallTouch).toBe("none");
	});

	it("does not detect right face when at world bound", () => {
		const right = platforms[2]; // { x: 700, y: 220, w: 100, h: 32 }, right edge = 800
		const p = pos({
			x: right.x + right.w - PLAYER_WIDTH,
			y: right.y,
			vx: -PLAYER_WALK_SPEED,
			vy: 0,
		});
		const r = tick(p, { left: true });
		expect(r.wallTouch).toBe("none");
	});
});

describe("fast movement edge cases", () => {
	const plat = platforms[1]; // { x: 40, y: 250, w: 100, h: 32 }

	it("catches dash-speed movement into wall", () => {
		const p = pos({
			x: plat.x - 20,
			y: plat.y,
			vx: 1000,
			vy: 0,
		});
		const r = tick(p);
		expect(r.wallTouch).toBe("right");
		expect(r.x).toBe(plat.x - PLAYER_WIDTH);
		expect(r.vx).toBe(0);
	});

	it("catches player moving very close to wall edge", () => {
		const p = pos({
			x: plat.x - PLAYER_WIDTH,
			y: plat.y,
			vx: PLAYER_WALK_SPEED,
			vy: 0,
		});
		const r = tick(p, { right: true });
		expect(r.wallTouch).toBe("right");
	});

	it("catches player barely overlapping left edge", () => {
		const p = pos({
			x: plat.x - 4,
			y: plat.y,
			vx: PLAYER_WALK_SPEED,
			vy: 0,
		});
		const r = tick(p, { right: true });
		expect(r.wallTouch).toBe("right");
	});
});

describe("wall jump", () => {
	const plat = platforms[1]; // { x: 40, y: 250, w: 100, h: 32 }

	it("launches away from wall when jump pressed while touching wall", () => {
		const p = pos({
			x: plat.x - PLAYER_WIDTH,
			y: plat.y,
			vx: PLAYER_WALK_SPEED,
			vy: 0,
			wallTouch: "right",
		});
		const r = tick(p, { right: true, up: true });
		expect(r.vx).toBe(-WALL_JUMP_HORIZONTAL);
		expect(r.vy).toBe(WALL_JUMP_VERTICAL);
		expect(r.wallJumpTimer).toBe(WALL_JUMP_LOCKOUT);
		expect(r.wallTouch).toBe("none");
	});

	it("wall jump lockout prevents horizontal input", () => {
		const p = pos({
			x: plat.x - PLAYER_WIDTH,
			y: plat.y,
			vx: 0,
			vy: 0,
			wallJumpTimer: 500,
		});
		const r = tick(p, { right: true });
		expect(r.wallJumpTimer).toBe(500 - DT * 1000);
		expect(r.vx).toBe(0);
	});

	it("wall jump lockout eventually expires", () => {
		const p = pos({
			x: plat.x - PLAYER_WIDTH,
			y: plat.y,
			wallJumpTimer: 100,
		});
		const r = ticks(p, {}, Math.ceil(100 / (DT * 1000)));
		expect(r.wallJumpTimer).toBe(0);
	});

	it("ground jump takes priority over wall jump", () => {
		const p = pos({
			x: plat.x - PLAYER_WIDTH,
			y: plat.y,
			vx: PLAYER_WALK_SPEED,
			vy: 0,
			grounded: true,
			wallTouch: "right",
		});
		const r = tick(p, { right: true, up: true });
		expect(r.vy).toBe(JUMP_VELOCITY);
		expect(r.vx).not.toBe(-WALL_JUMP_HORIZONTAL);
	});
});

describe("player goes through platform (user bug)", () => {
	const plat = platforms[1]; // { x: 40, y: 250, w: 100, h: 32 }
	const mid = platforms[3]; // { x: 550, y: 400, w: 100, h: 32 }

	it("does NOT go through left wall at walk speed", () => {
		let p = pos({
			x: 10,
			y: plat.y,
			vx: 0,
			vy: 0,
		});
		for (let i = 0; i < 300; i++) {
			p = tick(p, { right: true });
			if (p.wallTouch === "right") break;
		}
		expect(p.wallTouch).toBe("right");
	});

	it("does NOT go through left wall at dash speed", () => {
		let p = pos({
			x: 10,
			y: plat.y,
			vx: 1000,
			vy: 0,
		});
		for (let i = 0; i < 300; i++) {
			p = tick(p);
			if (p.wallTouch === "right") break;
		}
		expect(p.wallTouch).toBe("right");
	});

	it("does NOT go through right wall of middle platform", () => {
		let p = pos({
			x: mid.x + mid.w + 10,
			y: mid.y,
			vx: 0,
			vy: 0,
		});
		for (let i = 0; i < 300; i++) {
			p = tick(p, { left: true });
			if (p.wallTouch === "left") break;
		}
		expect(p.wallTouch).toBe("left");
	});

	it("does NOT go through left wall when falling toward it", () => {
		let p = pos({
			x: plat.x - 10,
			y: plat.y,
			vx: PLAYER_WALK_SPEED,
			vy: 0,
		});
		for (let i = 0; i < 300; i++) {
			p = tick(p, { right: true });
			if (p.wallTouch !== "none") break;
		}
		expect(p.wallTouch).toBe("right");
	});

	it("gets pushed out if somehow overlapping platform", () => {
		const p = pos({
			x: plat.x + 10,
			y: plat.y + 5,
			vx: PLAYER_WALK_SPEED,
			vy: 50,
		});
		const r = tick(p, { right: true });
		const fullyInside =
			r.x + PLAYER_WIDTH > plat.x + 4 &&
			r.x < plat.x + plat.w - 4 &&
			r.y + PLAYER_HEIGHT > plat.y + 4 &&
			r.y < plat.y + plat.h - 4;
		expect(fullyInside).toBe(false);
	});

	it("catches player falling past a platform and moving into it", () => {
		let p = pos({
			x: plat.x - 10,
			y: plat.y - PLAYER_HEIGHT,
			vx: PLAYER_WALK_SPEED,
			vy: 500,
		});
		for (let i = 0; i < 60; i++) {
			p = tick(p, { right: true });
			if (p.wallTouch !== "none") break;
		}
		expect(p.wallTouch).toBe("right");
	});

	it("does not clip through left wall at high framerate (dt=1/30)", () => {
		const p = pos({
			x: plat.x - 20,
			y: plat.y,
			vx: 1000,
			vy: 0,
		});
		const r = tick(p, { right: true }, 1 / 30);
		expect(r.wallTouch).toBe("right");
		expect(r.x).toBe(plat.x - PLAYER_WIDTH);
	});
});
