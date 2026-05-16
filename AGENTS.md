# Vento Áureo

## Tech Stack
- Phaser 4.1.0 (game framework)
- React 19 (UI overlay)
- Vite 6 (bundler)
- TypeScript 5.7 (strict mode)
- Arcade Physics

## Architecture
- `src/game/` — all Phaser game code
  - `scenes/` — Phaser scenes (Boot, Game)
  - `characters/` — Player, AIEnemy, EnemyBrain
  - `weapons/` — weapon behavior
  - `skills/` — Bullets, skills
  - `anims/` — animation definitions
  - `online/` — Geckos.io client (OnlineManager, types)
  - `EventBus.ts` — cross-framework events (Phaser → React)
  - `main.ts` — Phaser 4 game config
- `server/` — Geckos.io authoritative game server (physics, rooms)
- `src/App.tsx` — React root with bullet count counter
- `specs/` — game design documentation (combat, movement mechanics)
- `public/assets/` — static game assets

## Important Rules
- Input handling is in `Game.ts` scene, NOT in `Player.ts` (prevents duplicate listeners from multiple player instances)
- AI enemy (`AIEnemy.ts`) is controlled by `EnemyBrain.ts` state machine; configurable from React via `AIConfig.ts`
- Only main player responds to `pointerdown`; AI enemy is AI-controlled
- `EventBus` is used for Phaser→React communication (e.g. `bullet-fired`, `enemy-hp-changed` events)
- Phaser 4 API differences from v3: use `color` not `fill` in TextStyle, `currentAnim.key` not `getCurrentKey()`, gravity requires `{x, y}` object
- Build: `npm run dev` (Vite, port 8080), `tsc --noEmit` for type checking, `vite build` for production
- Dev server runs in tmux session `vento-aureo-server` (`tmux attach -t vento-aureo-server` to see logs)
- Server: `npm run dev:server` (Geckos.io, port 9208), or `npm run dev:all` for both Vite + server
- Online mode: `http://localhost:8080/?online=true` — open in two tabs to match
	- Client-side prediction: local physics runs on input immediately, player sprite moves responsively
	- Server reconciliation: gentle position correction (15% lerp) per snapshot prevents drift
	- Remote player interpolation: lerps towards target position at 12x speed for smooth 20Hz→60fps movement
	- `pointerdown` is guarded to prevent local bullet creation in online mode
	- `match` event only fires when both players have joined (playerCount >= 2), broadcast to all in room
	- Bullet sprite pool (lazy-grown, recycled via `Phaser.GameObjects.Sprite.active`) replaces unbounded sprite creation
- AI debug mode: add `&ai=true` to make the local player AI-controlled (e.g. `?online=true&ai=true`)
	- Creates `EnemyBrain` for the local player; generates AI inputs instead of keyboard inputs
	- Keep body enabled so AI can detect `touching.down` for jump decisions
	- Use both tabs with `&ai=true` for AI vs AI debugging in online mode
- Online match-end: when a player reaches 0 HP, server waits 1.5s then resets both to 100 HP at start positions (clears bullets). Client applies death alpha (0.3) to both sprites when HP <= 0.
- Game tick bug fix: server loop now passes absolute `performance.now()` timestamps to `GameRoom.tick()` (was passing deltas, causing physics to never advance)
- Always run `tsc --noEmit` and `vite build` after making changes to ensure type safety
- Wall jump: trigger by pressing jump (W/up) while airborne and touching a platform side
  - Wall jump lockout: 700ms (horizontal input ignored during lockout)
  - Launches away from wall: 100 px/s horizontal, -100 px/s vertical
  - Priority: ground jump > wall jump (ground jump only when grounded)
  - Platform side tolerance: 4px overlap detection
  - `PlayerPosition.wallTouch` tracks "left"/"right" wall contact; `wallJumpTimer` counts down lockout
  - AI enemies use `touchingLeft`/`touchingRight` perception (EnemyBrain line 228-234) for wall jump decision
  - Shared in `Physics.ts`: same physics on client and server
- AI bullet hit and enemy collision: in `updateBullets()`, the handlers `onPlayerBulletHitEnemy`/`onEnemyBulletHitPlayer` take `LocalBullet` objects (not index), sprite lifecycle managed in `updateBullets()` via `setVisible`/`splice`

## Debugging & AI vs AI Mode

### Console Commands (open F12 DevTools)
- `window.__toggleAIVsAI()` — toggle AI vs AI mode (both fighters AI-controlled)
- `window.__gameState()` — print current state: HP, AI states, mode flag
- Press **P** key to toggle AI vs AI mode in-game

### AI vs AI Mode
When enabled, the player character is also AI-controlled via a second `EnemyBrain`.
Both AIs fight each other. When one reaches 0 HP, both reset to 100 HP after 1.5s.
Console logs all fight events:
- `[FIGHT]` — bullet hit, HP change
- `[STATE]` — AI state transitions  
- `=== AI VS AI MODE [ENABLED|DISABLED] ===` — mode toggles

### Console Log Output
- `[FIGHT] Player bullet hit enemy! Enemy HP: 90`
- `[FIGHT] Enemy defeated!`
- `[STATE] Player: ATTACK | Enemy: EVADE | HP 70 vs 50`
