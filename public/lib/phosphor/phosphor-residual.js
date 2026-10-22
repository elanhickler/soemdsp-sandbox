// Shared phosphor residual model (app-wide).
//
// Display Settings order (shared faces, including Lorenz):
//   Size -> Blur -> Bright -> Ghost -> Trail -> Scale -> Antialiasing -> Dot Budget
//
// Axes (SSOT; high = more of the named quality):
//   Bright      -> peak deposit / live light
//   Trail       -> decay rate of bright residual (1 = freeze)
//   Ghost       -> decay curve of the dim tail: as stored light dims its fade
//                  eases from the Trail rate toward the (slower) Ghost rate.
//                  Ghost only changes how fast stored light fades from now
//                  on. No floor, no cap, no gain: it still fades to black.
//   Burn Amount -> deposit gain multiplier vs Bright for new residual (default 1)
//   Background  -> only the display's Background Brightness (not here).
//
// Used by energy-GL, drawer, matrix, asciiscope.

(function initPhosphorResidual(global) {
  const DEFAULT_TRAIL = 0.3;
  const DEFAULT_GHOST = 0.25;
  const DEFAULT_BURN_AMOUNT = 1;
  const BURN_AMOUNT_MAX = 4;
  // Ghost -> dim-tail time constant, continuous from 0: tau = MAX * g^2
  // (g 0 = no tail, 0.001 = 60 us, 0.01 = 6 ms, 0.1 = 0.6 s, 0.5 = 15 s,
  // 1 = 60 s). Added to the Trail time constant, so Ghost only lengthens.
  const GHOST_TAIL_MAX_S = 60;
  // DestFade ghost layer (Trace): same curve, its own (shorter) scale.
  const DEST_GHOST_MAX_S = 3.3;
  // Decay knee: keep = mix(keepSlow, keepFast, e^KNEE). Bright energy fades at
  // the Trail rate; once dimmer it eases (smoothly, no threshold) onto the
  // Ghost rate. A linear weight (e^1) made every Ghost reach 10% in ~0.6 s.
  const RESIDUAL_KNEE_POWER = 12;

  function clamp01(value, fallback = 0) {
    return globalThis.SoemMath.clamp01(value, fallback);
  }

  /**
   * Per-frame erase amount from Trail (high trail = low erase).
   */
  function trailFadeAmount(trail) {
    const t = clamp01(trail, DEFAULT_TRAIL);
    const d = 1 - t;
    // Continuous to 0 at Trail 1 (freeze): the old 0.006 floor made Trail
    // 0.999 a ~3 s hang and Trail 1 infinite.
    return Math.min(0.55, d * 0.11 + d * d * 0.32 + 0.006 * (1 - Math.exp(-d / 0.02)));
  }

  /** keepFast from Trail (hot path). */
  function trailKeep(trail) {
    return Math.max(0, 1 - trailFadeAmount(trail));
  }

  /** Ghost dim-tail time constant in seconds (0 at Ghost 0). */
  function ghostTailSeconds(ghost) {
    const g = clamp01(ghost, 0);
    return GHOST_TAIL_MAX_S * g * g;
  }

  /** Per-60fps-frame keep -> time constant (s), and back. */
  function keepToSeconds(keep) {
    const k = clamp01(keep, 0);
    if (k >= 1) return Infinity;
    if (!(k > 0)) return 0;
    return -1 / (60 * Math.log(k));
  }
  function secondsToKeep(tau) {
    if (!(tau > 0)) return 0;
    if (!Number.isFinite(tau)) return 1;
    return Math.exp(-1 / (60 * tau));
  }

  /**
   * keepSlow (dim tail) for Ghost: tau = tau(baseKeep) + ghostTailSeconds.
   * Ghost 0 = baseKeep exactly (no tail); rises smoothly, no switch.
   */
  function ghostKeep(ghost, baseKeep) {
    const k = clamp01(baseKeep, 0);
    return Math.max(k, secondsToKeep(keepToSeconds(k) + ghostTailSeconds(ghost)));
  }

  /**
   * Trail-only plate wipe for DestFade hot path. Ghost is a separate dim
   * scorch layer (destGhostEraseAmount) -- mixing Ghost into this erase made
   * Ghost feel identical to Trail.
   */
  function destFadeAmount(trail, _ghost = 0) {
    return trailFadeAmount(trail);
  }

  /**
   * Ghost-layer erase/frame (independent of Trail). Continuous from 0:
   * Ghost 0 erases everything at once (no layer), tau = 3.3 s * g^2.
   */
  function destGhostEraseAmount(ghost) {
    const g = clamp01(ghost, 0);
    return 1 - secondsToKeep(DEST_GHOST_MAX_S * g * g);
  }

  /**
   * Keep factor (per 60 fps frame) for one stored energy level. Full energy
   * keeps at the Trail rate; dimmer energy eases toward the Ghost tail rate.
   * GPU steps use the same mix(keepSlow, keepFast, clamp(e, 0, 1)^KNEE).
   */
  function residualKeepAt(energy01, keepFast, keepSlow) {
    const kf = clamp01(keepFast, 0);
    const ks = Math.max(kf, clamp01(keepSlow, 0));
    const level = Math.max(0, Math.min(1, nodeGraphFiniteNumber(energy01)));
    return ks + (kf - ks) * Math.pow(level, RESIDUAL_KNEE_POWER);
  }

  /**
   * Continuous-time form of the residual exponential: energy * e^(-age / tau).
   * Same keep as secondsToKeep: pow(keep, age * 60) == exp(-age / tau).
   * tauSeconds <= 0 holds (fade time 0 = stay until retrigger).
   */
  function energyAfterSeconds(energy01, tauSeconds, ageSeconds) {
    const e = Math.max(0, nodeGraphFiniteNumber(energy01));
    if (!(e > 0)) return 0;
    const tau = Number(tauSeconds);
    if (!(tau > 0) || !Number.isFinite(tau)) return e;
    const age = Math.max(0, Number(ageSeconds) || 0);
    const keep = secondsToKeep(tau);
    if (!(keep > 0)) return 0;
    return e * Math.pow(keep, age * 60);
  }

  /**
   * Residual step: stored energy times the decay keep, over `frames` 60 fps
   * frames (pass elapsed time so decay time is frame-rate independent).
   * Never raises energy; Ghost/Trail only set the rate.
   */
  function applyResidual(energy01, trail, ghost = 0, frames = 1) {
    const e = Math.max(0, nodeGraphFiniteNumber(energy01));
    if (!(e > 0)) {
      return 0;
    }
    const keepFast = trailKeep(trail);
    if (keepFast >= 1) {
      return e; // Trail freeze
    }
    const keep = residualKeepAt(e, keepFast, ghostKeep(ghost, keepFast));
    const f = Math.max(0, Number.isFinite(Number(frames)) ? Number(frames) : 1);
    return e * Math.pow(keep, f);
  }

  /**
   * 60 fps frames since holder[key] was last stepped, capped at 4 so a
   * stall fades a few frames, not the whole burn. First call = 1 frame.
   */
  function stepFrames(holder, key = "residualStepMs") {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const last = holder ? Number(holder[key]) : 0;
    if (holder) {
      holder[key] = now;
    }
    if (!(last > 0)) {
      return 1;
    }
    return Math.max(0, Math.min(4, (now - last) * 0.06));
  }

  /**
   * Patch fields -> trail 0..1 (high = long). SSOT: source.trail only.
   */
  function migrateTrail(source = {}, fallback = DEFAULT_TRAIL) {
    if (source && source.trail != null && Number.isFinite(Number(source.trail))) {
      return clamp01(Number(source.trail), fallback);
    }
    return clamp01(fallback, DEFAULT_TRAIL);
  }

  /**
   * Patch fields -> ghost 0..1 (high = more scorch hang). SSOT: source.ghost only.
   */
  function migrateGhost(source = {}, fallback = DEFAULT_GHOST) {
    if (source && source.ghost != null && Number.isFinite(Number(source.ghost))) {
      return clamp01(Number(source.ghost), fallback);
    }
    return clamp01(fallback, DEFAULT_GHOST);
  }

  /** Sleep frame budget so ghost hang is not killed early. */
  function residualSleepFrames(ghost) {
    // 240 frames plus ~7 tail time constants (dim tail down to ~1e-3).
    return Math.round(240 + 60 * 7 * ghostTailSeconds(ghost));
  }

  function residualKeeps(trail, ghost = 0, burnAmount = 1) {
    const keepFast = trailKeep(trail);
    const keepSlow = ghostKeep(ghost, keepFast);
    return {
      keepFast,
      keepSlow,
      fade: trailFadeAmount(trail),
      keep: keepFast,
      trail: clamp01(trail, DEFAULT_TRAIL),
      ghost: clamp01(ghost, 0),
      burnAmount: Number.isFinite(Number(burnAmount)) ? Number(burnAmount) : 1,
    };
  }

  function clampBurnAmount(v, fb = 1) {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      return Math.max(0, Math.min(BURN_AMOUNT_MAX, nodeGraphFiniteNumber(fb, 1)));
    }
    return Math.max(0, Math.min(BURN_AMOUNT_MAX, n));
  }

  function migrateBurnAmount(source = {}, fallback = 1) {
    const n = Number(source?.burnAmount);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.min(BURN_AMOUNT_MAX, n));
    }
    return Math.max(0, Math.min(BURN_AMOUNT_MAX, nodeGraphFiniteNumber(fallback, 1)));
  }

  /** Residual deposit peak = Bright x Burn Amount (live tip stays Bright). */
  function depositBrightness(bright, burnAmount = 1) {
    const b = Math.max(0, nodeGraphFiniteNumber(bright));
    const a = clampBurnAmount(burnAmount, 1);
    return Math.max(0, b * a);
  }

  const api = {
    DEFAULT_TRAIL,
    DEFAULT_GHOST,
    DEFAULT_BURN_AMOUNT,
    BURN_AMOUNT_MAX,
    RESIDUAL_SCHEMA: 4,
    clamp01,
    clampBurnAmount,
    trailFadeAmount,
    trailKeep,
    ghostKeep,
    ghostTailSeconds,
    keepToSeconds,
    secondsToKeep,
    GHOST_TAIL_MAX_S,
    RESIDUAL_KNEE_POWER,
    destFadeAmount,
    destGhostEraseAmount,
    energyAfterSeconds,
    applyResidual,
    residualKeepAt,
    stepFrames,
    residualKeeps,
    migrateTrail,
    migrateGhost,
    migrateBurnAmount,
    depositBrightness,
    residualSleepFrames,
  };

  global.PhosphorResidual = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
