# Vento Áureo

## ████████████████████████████████████████████████████
## ██  THE FEEDBACK LOOP IS THE MOST IMPORTANT PART  ██
## ██  ALL FIXES MUST BE VERIFIED THROUGH MEASUREMENT ██
## ████████████████████████████████████████████████████

**Never guess at a physics fix without running `window.__physicsDiagnostic()` first and after.** The diagnostic tool provides structured JSON data that the LLM can parse and reason about. Every fix must be a measurable improvement: `jitterSummary.total` must decrease, and ideally hit 0.

Load the feedback-loop skill for full details:
```
skill({ name: "feedback-loop" })
```

Key one-shot workflow:
1. Run Playwright → __physicsDiagnostic() → capture report
2. Analyze jitterEvents[], reconciliationSummary[], verdict
3. Fix code, verify compilation with `tsc --noEmit` and `vite build`
4. Re-run diagnostic — confirm verdict goes from FAIL to PASS
5. Run 3 consecutive tests for stability
6. Update AGENTS.md with findings

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

## Physics Model
- **Fixed timestep accumulator** (`PHYSICS_DT = 1/60`): client physics runs at exactly 60Hz regardless of display FPS, matching the server's fixed-step physics
- `physicsAccumulator` in `Game.ts` accumulates real frame dt and runs `tickPlayer()`/`tickBullet()` in fixed 16.67ms steps (max 5 steps per frame to prevent spiral of death)
- Server reconciliation: snaps directly when error > 100px (fight resets, large desyncs), otherwise 15% lerp per 20Hz snapshot
- Remote interpolation: frame-rate-independent lerp via `friLerp()` function using `1 - pow(1-factor, dtSec*60)`
- AI evade physics unified with `tickPlayer()` using GRAVITY constant

## Physics Diagnostic Tool

### Console Commands (open F12 DevTools)
- `window.__toggleAIVsAI()` — toggle AI vs AI mode (both fighters AI-controlled)
- `window.__gameState()` — print current state: HP, AI states, mode flag
- `window.__physicsDiagnostic(durationMs=5000)` — collects frame data for N ms, outputs JSON report
- Press **P** key to toggle AI vs AI mode in-game

### `__physicsDiagnostic()` Output Format
The function prints `__DIAGNOSTIC_RESULT__{...json...}__END__` to console. Report structure:
```json
{
  "mode": "offline|online",
  "totalFrames": 425,
  "fpsStats": { "minFps": 85, "maxFps": 85, "avgFps": 85, "avgDtMs": 11.77, "dtStdDevMs": 0.01 },
  "physicsStepDistribution": { "zeroStepFrames": 125, "oneStepFrames": 300, "pctZeroStep": 29 },
  "jitterEvents": [{"frame": 100, "type": "player_x", "delta": 47.13, "severity": 1.35}],
  "jitterSummary": { "total": 0, "avgSeverity": 0, "maxSeverity": 0, "byType": {} },
  "reconciliationEvents": [{"frame": 0, "serverX": 410, "clientX": 405, "correction": 5.9}],
  "reconciliationSummary": { "totalCorrections": 125, "avgErrorPx": 33, "maxErrorPx": 343 },
  "verdict": "PASS: No jitter detected"
}
```

### Using the Diagnostic with Playwright
```javascript
// 1. Navigate to game
await page.goto('http://localhost:8080');
// 2. Enable AI vs AI mode for automatic movement
await page.keyboard.press('p');
await page.waitForTimeout(2000);
// 3. Start diagnostic
await page.evaluate(() => window.__physicsDiagnostic(5000));
// 4. Wait for completion, capture result
await page.waitForTimeout(6000);
const msgs = page._console; // collect log messages
// 5. Parse the __DIAGNOSTIC_RESULT__ line for structured analysis
// verdict === "PASS" means no jitter detected
```

### Jitter Thresholds
- player_x: 35px (covers 30fps dash x2)
- player_y: 25px (covers 30fps falling x2)
- camera: 15px
- Fight reset teleports (>100px error) snap client directly; skip-jitter flag prevents double-counting

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

## Skill Reference
The complete diagnostic workflow, Playwright test patterns, calibration scripts, and jitter source catalog live in the agent skill:
- `.agents/skills/feedback-loop/SKILL.md`
- Load with: `skill({ name: "feedback-loop" })`
