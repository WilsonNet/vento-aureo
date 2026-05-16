# Combat Mechanics

## Stance System
- **Q**: Switch to **Melee** stance
- **E**: Switch to **Ranged** stance
- Current stance determines attack behavior on mouse click
- Default stance at spawn: **Ranged**
- Stance switch is instant with no cooldown

## Ranged Combat
- **Left-click**: Fire a bullet toward the cursor position
- Bullet speed: **600 px/s**
- Bullet pool: 900 pre-allocated (recycled via object pool)
- Unlimited ammunition — no ammo management
- Facing direction: determined by mouse cursor angle from player
- Bullets travel until they leave the world bounds
- `EventBus` emits `bullet-fired` on each shot (used by React UI)

## Melee Combat
- Requires **Melee stance** (press Q)
- **Left-click**: Swing melee hitbox
- Hitbox: bomb sprite spawned **30px** in front of the player's facing direction
- Hitbox duration: **150ms** then self-destructs
- Hitbox follows the player's position during its lifetime
- Facing direction: determined by current animation key (`left` vs `right`)

## Blocking
- Requires **Melee stance** (press Q)
- **Right-click (hold)**: Enter blocking state
- While blocking:
  - Horizontal velocity zeroed (only when grounded or in natural movement state)
  - Character forced into idle animation
  - *(Damage reduction not yet implemented)*
- **Right-click release**: Exit blocking state
- Blocking state does not prevent vertical knockback or being launched

## Damage Model
- *(To be implemented)*
- Bullet damage per hit
- Melee damage per swing
- Blocking damage reduction percentage
- Knockback on hit
- Invincibility frames on damage
