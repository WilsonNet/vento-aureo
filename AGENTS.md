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
- `public/assets/` — static game assets

## Important Rules
- Input handling is in `Game.ts` scene, NOT in `Player.ts` (prevents duplicate listeners from multiple player instances)
- Only main player responds to `pointerdown`; co-op player is AI-controlled
- `EventBus` is used for Phaser→React communication (e.g. `bullet-fired` event)
- Phaser 4 API differences from v3: use `color` not `fill` in TextStyle, `currentAnim.key` not `getCurrentKey()`, gravity requires `{x, y}` object
- Build: `npm run dev` (Vite, port 8080), `tsc --noEmit` for type checking, `vite build` for production
- Always run `tsc --noEmit` and `vite build` after making changes to ensure type safety
