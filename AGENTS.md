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
  - `characters/` — Player (main + co-op), Enemy
  - `weapons/` — weapon behavior
  - `skills/` — Bullets, skills
  - `anims/` — animation definitions
  - `EventBus.ts` — cross-framework events (Phaser → React)
  - `main.ts` — Phaser 4 game config
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
- Always run `tsc --noEmit` and `vite build` after making changes to ensure type safety

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
