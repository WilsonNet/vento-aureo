---
name: feedback-loop
description: "CRITICAL: Use this skill when diagnosing physics jitter, network desync, or gameplay bugs in Vento Ãureo. Covers the __physicsDiagnostic() tool, Playwright test workflow, reading diagnostic JSON reports, fixed-timestep model, reconciliation snap logic, jitter thresholds, and the one-shot feedback loop pattern. Triggers on: jitter, diagnostic, physics bug, desync, reconciliation, teleport, rubber-banding, stutter, framerate issue, Playwright test, feedback loop."
license: MIT
compatibility: opencode
---

# Physics Diagnostic & Feedback Loop

**This is the most important part of the project.** Every fix must be verified through the feedback loop below. Do NOT guess at code changes without running the diagnostic first and after to confirm the fix.

## Build Missing Tools First

If the feedback loop is incomplete — missing diagnostic functions, missing Playwright scripts, missing console logging, missing any measurable output — **stop and build the missing tool before attempting any fix.**

The rule: **if you can't measure it, you can't fix it.** Never proceed with a physics fix if:
- There is no `window.__physicsDiagnostic()` (or equivalent) producing structured data
- There is no Playwright workflow to capture and deliver that data to the LLM
- The diagnostic output lacks the specific metric you need (e.g., reconciliation error, jitter events, physics step distribution)
- The game cannot run autonomously (AI vs AI mode, automated input)

In those cases, your first task is to **build the measurement tool**, then run it to get a baseline, then fix, then re-measure. A half-measure with no feedback loop is worse than no fix at all — it wastes time and creates false confidence.

## Architecture Overview

The game has a Physics Diagnostic Tool that emits structured JSON reports. These reports are captured by Playwright and fed back to the LLM as hard numerical data. This replaces blind guessing with a measurable feedback loop.

```
[Game] --window.__physicsDiagnostic()--> JSON report --> console
                                                           |
[Playwright] --page.evaluate()--> reads console --> parses JSON
                                                           |
[LLM] analyzes report --> codes fix --> Playwright re-runs diagnostic
                                                           |
                                                    verify verdict === "PASS"
```

## Physics Model

- **Fixed timestep accumulator** (`src/game/scenes/Game.ts`): `PHYSICS_DT = 1/60`. Accumulates real frame dt and runs `tickPlayer()` / `tickBullet()` in fixed 16.67ms steps. Max 5 steps per frame to prevent spiral of death.
- **Server reconciliation** (`applySnapshot` in `Game.ts`): snaps directly when error > 100px (fight resets, large desyncs); otherwise 15% lerp per 20Hz snapshot.
- **Remote interpolation** (`updateRemoteInterpolation`): frame-rate-independent lerp via `friLerp()` using `1 - Math.pow(1 - factor, dtSec * 60)`.
- **AI evade physics**: unified with `tickPlayer()` using shared GRAVITY constant (`src/game/simulation/Physics.ts`).
- **Shared physics**: `src/game/simulation/Physics.ts` is used identically by both client and server. No divergence.
- **Server**: `server/GameRoom.ts` uses `TICK_RATE = 1000/60` and `BROADCAST_RATE = 1000/20`.

## Diagnostic Tool: `window.__physicsDiagnostic(durationMs)`

### How It Works

Added to `Game.ts` create() alongside `__toggleAIVsAI` and `__gameState`. The function:

1. Sets `_diagActive = true` and initializes frame buffers.
2. Each game `update()` frame records: `playerX/Y/Vx/Vy`, `enemyX/Y/Vx/Vy`, `cameraX/Y`, `t`, `dt`, `physicsSteps`.
3. At the end of the sample period, computes statistics and outputs the report.
4. The report is `console.log`'d wrapped in:
   ```
   __DIAGNOSTIC_RESULT__{...json...}__END__
   ```

### Output Format

```json
{
  "mode": "offline|online",
  "durationMs": 5000,
  "totalFrames": 425,
  "fpsStats": {
    "minFps": 85,
    "maxFps": 85,
    "avgFps": 85,
    "avgDtMs": 11.77,
    "dtStdDevMs": 0.01
  },
  "physicsStepDistribution": {
    "zeroStepFrames": 125,
    "oneStepFrames": 300,
    "twoStepFrames": 0,
    "pctZeroStep": 29
  },
  "playerMovement": {
    "xRange": [255, 361],
    "yRange": [336, 520],
    "totalTravelPx": 1117
  },
  "jitterEvents": [
    {
      "frame": 100,
      "type": "player_x",
      "delta": 47.13,
      "expectedMax": 35,
      "severity": 1.35
    }
  ],
  "jitterSummary": {
    "total": 0,
    "avgSeverity": 0,
    "maxSeverity": 0,
    "byType": {}
  },
  "reconciliationEvents": [
    {
      "frame": 0,
      "serverX": 410.75,
      "clientX": 405.74,
      "correction": 5.90
    }
  ],
  "reconciliationSummary": {
    "totalCorrections": 125,
    "avgErrorPx": 33.24,
    "maxErrorPx": 343.19,
    "cumulativeDriftPx": 4154.53
  },
  "verdict": "PASS: No jitter detected"
}
```

### Field Meanings

| Field | Meaning |
|-------|---------|
| `fpsStats` | Framerate analysis. `dtStdDevMs` < 0.5 means stable framerate. |
| `physicsStepDistribution` | How many physics steps ran per frame. `pctZeroStep > 10%` means display FPS exceeds physics FPS (normal for >60fps). At 60fps: 0% zero-step frames = perfect. |
| `jitterEvents[]` | Frames where position delta exceeded the threshold. Each event has `type` (player_x, player_y, enemy_x, enemy_y, camera_x, camera_y), `delta` (px), `severity` (multiple of threshold). **Fight resets are filtered out.** |
| `jitterSummary` | Aggregated jitter stats. `total` is the key metric to track. |
| `reconciliationEvents[]` | **Online mode only.** Every server snapshot correction. `serverX` = authoritative pos, `clientX` = client pos AFTER correction, `correction` = euclidean error BEFORE correction was applied. |
| `reconciliationSummary` | Aggregated reconciliation stats. `avgErrorPx` shows typical server-client divergence. `maxErrorPx` shows worst-case. `cumulativeDriftPx` is sum of all corrections. |
| `verdict` | `"PASS"` if zero jitter events. `"FAIL: N jitter events detected"` otherwise. |

### Jitter Thresholds (in `Game.ts` constants)

| Constant | Value | Rationale |
|----------|-------|-----------|
| `DIAG_JITTER_X` | 35px | Covers max 2-step dash at 30fps (33.3px) with headroom. Captures reconciliation snaps >35px. |
| `DIAG_JITTER_Y` | 25px | Covers max 2-step free-fall at 30fps (20px) with headroom. Captures vertical reconciliation snaps. |
| `DIAG_JITTER_CAM` | 15px | Camera should move smoothly; large single-frame camera moves indicate jitter. |

Calibrate with Python:
```python
PHYSICS_DT = 1/60
DASH_SPEED = 1000
GRAVITY = 300
max_x = DASH_SPEED * PHYSICS_DT * 2  # 33.3px (2 steps at 30fps)
max_y = GRAVITY * 2 * PHYSICS_DT * 2 # 20px (2 steps falling at 30fps)
```

### Skipped Frames

Fight reset teleports are excluded from jitter detection via `_diagSkipJitter = true` flag set in `resetFight()`. Online server reconciliation snapshots with error >100px snap directly (no lerp), which may cause a single-frame jitter event at the reset boundary. This is intentional.

## Playwright Test Workflow

### Setup
```javascript
// Start servers (already running in tmux session "vento-aureo-server")
// Vite on port 8080, Geckos.io on port 9208

// Navigate to game
await page.goto('http://localhost:8080');
await page.waitForTimeout(1000);
```

### Offline AI-vs-AI Test
```javascript
// Enable AI vs AI mode (both fighters AI-controlled)
await page.keyboard.press('p');
await page.waitForTimeout(2000);

// Start diagnostic
const result = await page.evaluate(() => window.__physicsDiagnostic(5000));
// => "DIAGNOSTIC_STARTED: 5000ms"

// Wait for completion
await page.waitForTimeout(6000);

// Read diagnostic JSON from console
const msgs = await page.evaluate(() => {
    // Collect all console entries
    return window.__consoleLogs || [];
});
// Parse: JSON.parse(msg.split('__DIAGNOSTIC_RESULT__')[1].split('__END__')[0])
```

### Online AI-vs-AI Test
```javascript
// Open two tabs with AI online mode
await page.goto('http://localhost:8080/?online=true&ai=true');
// Open second tab
const page2 = await context.newPage();
await page2.goto('http://localhost:8080/?online=true&ai=true');

// Wait for match
await page.waitForTimeout(3000);

// Verify match via console messages: "[ONLINE] Matched in room room-N!"
await page.evaluate(() => window.__physicsDiagnostic(8000));
await page.waitForTimeout(10000);
```

### Parsing the Diagnostic Report

Regex to extract the JSON from console:
```javascript
/__DIAGNOSTIC_RESULT__(\{.+\})__END__/
```

Python parsing:
```python
import json, re
match = re.search(r'__DIAGNOSTIC_RESULT__(\{.*?\})__END__', console_str, re.DOTALL)
if match:
    report = json.loads(match.group(1))
```

### Verdict Interpretation

| Verdict | Meaning | Action |
|---------|---------|--------|
| `"PASS: No jitter detected"` | No frame-to-frame position anomalies. Physics is smooth. | Accept the fix. |
| `"FAIL: N jitter events detected"` | N frames had position jumps exceeding physics limits. | Analyze `jitterEvents[]` to identify the cause. |
| `jitterSummary.total === 0, verdict PASS` | Clean bill of health. | Run 3 consecutive 8s tests to confirm stability. |
| `jitterSummary.total > 0, type: player_x` | Jitter in local player horizontal position. Could be reconciliation or physics issue. | Cross-reference with `reconciliationEvents[]` at matching frames. |
| `reconciliationSummary.maxErrorPx > 100` | Large server-client discrepancy. Fight reset or severe desync. | Check if snap logic is working (>100px should snap directly). |

## Known Jitter Sources & Fixes

### 1. Variable Frame-rate Physics (FIXED)
**Root cause**: Client used variable `dtSec` for physics while server used fixed 1/60s. Different Euler integration trajectories.
**Fix**: Fixed-timestep accumulator (`physicsAccumulator`) in `Game.ts`. Runs `tickPlayer`/`tickBullet` at fixed 1/60s intervals.
**Verification**: `physicsStepDistribution.pctZeroStep` shows 29% at 85fps (expected), 0% at 60fps (perfect). No jitter events during normal gameplay.

### 2. Slow Reconciliation Lerp (FIXED)
**Root cause**: 15% lerp at 20Hz takes ~1s to converge a 100px error.
**Fix**: Snap directly when error > 100px (fight resets, large desyncs). 15% lerp for normal <100px corrections.
**Verification**: `reconciliationSummary.maxErrorPx` now shows instant correction for reset events instead of gradual rubber-banding over 30 frames.

### 3. Frame-rate Dependent Interpolation (FIXED)
**Root cause**: `lerpSpeed * dtSec` produces different results at different framerates.
**Fix**: `friLerp()` uses `1 - Math.pow(1 - factor, dtSec * 60)` for frame-rate-independent exponential smoothing.
**Verification**: Remote player position converges at same rate regardless of framerate.

### 4. AI Evade Separate Physics Path (FIXED)
**Root cause**: AI evade used hardcoded `GRAVITY = 300` and manual position integration, diverging from `tickPlayer()`.
**Fix**: Uses `tickPlayer()` + shared `GRAVITY` constant from `Physics.ts`. Evade speed set via `vx = dir * 300`.
**Verification**: Enemy position in diagnostic shows consistent physics between evade and normal states.

### 5. Fight Reset Teleport (KNOWN, INTENTIONAL)
**Root cause**: Server resets both players to start positions (700, 500) after a kill. Client sees 300-400px discrepancy.
**Behavior**: Client snaps directly to server position (error > 100px). Creates 1-frame teleport jitter event. This is visible but cannot be smoothly interpolated (teleports through walls are worse).
**Verification**: Single-frame jitter event at reset boundary, not a 30-frame rubber band.

## Python Physics Analysis Script

For proper threshold calibration and physics behavior analysis:

```python
import math

PHYSICS_DT = 1/60
WALK_SPEED = 160
DASH_SPEED = 1000
JUMP_VEL = -330
GRAVITY = 300

# Simulate physics accumulator at different framerates
for fps in [30, 60, 85, 120]:
    frame_dt = 1000 / fps
    frame_dt_sec = frame_dt / 1000
    acc = 0.0
    step_counts = []
    for _ in range(fps * 10):  # 10 seconds
        acc += frame_dt_sec
        steps = 0
        while acc >= PHYSICS_DT and steps < 5:
            steps += 1
            acc -= PHYSICS_DT
        step_counts.append(steps)
    max_steps = max(step_counts)
    zero_pct = sum(1 for s in step_counts if s == 0) / len(step_counts) * 100
    max_x = DASH_SPEED * PHYSICS_DT * max_steps
    print(f"FPS {fps}: max_steps={max_steps}, zero_pct={zero_pct:.0f}%, max_x/frame={max_x:.1f}px")
```

## Files That Implement the Feedback Loop

| File | Purpose |
|------|---------|
| `src/game/scenes/Game.ts` | All diagnostic collection + physics fixes. Lines: `PHYSICS_DT`, `_diag*` fields, `startDiagnostic()`, `finishDiagnostic()`, `recordDiagnosticFrame()`, `applySnapshot()` reconciliation, `fixedPhysicsStep()`, `friLerp()`. |
| `src/game/simulation/Physics.ts` | Shared physics constants and functions. `GRAVITY`, `PLAYER_WALK_SPEED`, `tickPlayer()`, `tickBullet()`. |
| `server/GameRoom.ts` | Server-side fixed-step physics. `TICK_RATE = 1000/60`, `BROADCAST_RATE = 1000/20`. |
| `AGENTS.md` | Project documentation with physics model and diagnostic instructions. |
| `.agents/skills/feedback-loop/SKILL.md` | **This file.** The LLM's guide to running diagnostics and interpreting results. |

## How to One-Shot a Physics Fix

1. **Read the diagnostic report** from the most recent Playwright run.
2. **Identify the issue** from `jitterEvents[]` and `reconciliationSummary`.
3. **Locate the root cause** in the source code (use the Known Jitter Sources table above).
4. **Apply the fix** in the appropriate file.
5. **Run `tsc --noEmit` and `vite build`** to verify compilation.
6. **Re-run the diagnostic** with Playwright (same settings).
7. **Compare old vs new reports**:
   - Before: `"jitterSummary": {"total": 47}`
   - After: `"jitterSummary": {"total": 0}`
   - Before: `"verdict": "FAIL: 47 jitter events detected"`
   - After: `"verdict": "PASS: No jitter detected"`
8. **Run 3 consecutive tests** to confirm stability.
9. **Update AGENTS.md** with any new findings.
