import geckos from "@geckos.io/server";
import { GameRoom } from "./GameRoom.js";

const io = geckos({ iceServers: [] });
const waitingRoom: GameRoom[] = [];
const activeRooms: GameRoom[] = [];
let nextRoomId = 1;

io.onConnection((channel) => {
	console.log(`[MATCH] New connection: ${channel.id}`);

	let room = waitingRoom.find((r) => !r.isFull);
	if (!room) {
		room = new GameRoom(`room-${nextRoomId++}`);
		waitingRoom.push(room);
		activeRooms.push(room);
		console.log(`[MATCH] Created room ${room.id}`);
	}

	const added = room.addPlayer(channel);
	if (added) {
		console.log(
			`[MATCH] Player ${channel.id} joined room ${room.id} (${room.playerCount}/2)`,
		);

		if (room.playerCount >= 2) {
			room.broadcast("match", { roomId: room.id, playerCount: room.playerCount });
			const idx = waitingRoom.indexOf(room);
			if (idx !== -1) waitingRoom.splice(idx, 1);
			console.log(`[MATCH] Room ${room.id} is full — match started!`);
		}
	}
});

function loop(time: number) {
	for (const room of activeRooms) {
		room.tick(time);
	}
	const deadRooms = activeRooms.filter((r) => r.playerCount === 0);
	for (const r of deadRooms) {
		const idx = activeRooms.indexOf(r);
		if (idx !== -1) activeRooms.splice(idx, 1);
	}
	setTimeout(() => loop(performance.now()), 16);
}

const PORT = 9208;
io.listen(PORT);
console.log(`[SERVER] Vento Aureo server listening on port ${PORT}`);
console.log(`[SERVER] Connect clients with ?online=true`);
loop(performance.now());
