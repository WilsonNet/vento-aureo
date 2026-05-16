# Movement Mechanics

## Basic Movement
- **WASD** controls movement: W = jump, A = left, D = right, S = crouch (future)
- Horizontal walk speed: **160 px/s**
- Jump velocity: **-330 px/s** (upward)
- Passive gravity: **300 px/s²**
- Bounce factor: **0.4** on landing

## Dash
- Double-tap **A** or **D** to dash in that direction
- Dash speed: **1000 px/s** (6.25x walk speed)
- Duration: **250ms** lockout
- Double-tap detection window: **200ms** between presses
- During dash: standard physics collision still applies
- Re-trigger: dash must complete (250ms) before another dash

## Wall Jump
- Trigger: press jump (W) while body is touching a wall (left/right collision)
- Launches the character **away** from the wall
- Horizontal velocity: **100 px/s** (away from wall)
- Vertical velocity: **-100 px/s** (upward)
- Wall jump lockout: **700ms** before normal movement resumes
- Priority order: ground jump > wall jump left > wall jump right

## Wall Climb
- *(Not yet implemented)*
- Intended mechanic: hold toward wall while airborne and in contact to climb
- Speed: slower than walk speed (e.g. 60 px/s upward)
- Stamina system: limited climb duration, drains while climbing
- Wall slide: gentle downward slide when not climbing
- Drop-off: release directional input or deplete stamina to fall
