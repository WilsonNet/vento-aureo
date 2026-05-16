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

export interface GameSnapshot {
	players: SnapshotPlayer[];
	bullets: SnapshotBullet[];
}

export interface MatchMessage {
	roomId: string;
	playerCount: number;
}

export interface PlayerInput {
	left: boolean;
	right: boolean;
	up: boolean;
	attack: boolean;
	aimAngle: number;
}
