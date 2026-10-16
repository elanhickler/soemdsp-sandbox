const canvas = document.getElementById("teleportCanvas");
const castButton = document.getElementById("castTeleportButton");
const packet = document.getElementById("teleportPacket");

const controls = {
  hue: document.getElementById("teleportHue"),
  charge: document.getElementById("teleportCharge"),
  pitch: document.getElementById("teleportPitch"),
  sparkle: document.getElementById("teleportSparkle"),
  duration: document.getElementById("teleportDuration"),
  shape: document.getElementById("teleportShape"),
};

let audioContext = null;
let particles = [];
let burstSerial = 0;
let lastTime = performance.now();

function clamp(value, min, max) {
  return globalThis.SoemMath.clamp(value, min, max, 0);
}

function readSettings() {
  return {
    hue: clamp(controls.hue.value, 0, 360),
    charge: clamp(controls.charge.value, 0, 1),
    pitch: clamp(controls.pitch.value, -12, 12),
    sparkle: clamp(controls.sparkle.value, 0, 1),
    duration: clamp(controls.duration.value, 0.35, 2.4),
    shape: controls.shape.value,
  };
}

function formatSigned(value, digits = 1) {
  const number = SoemMath.finiteOr(value, 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function updateOutputs() {
  const settings = readSettings();
  document.documentElement.style.setProperty("--arcane", `hsl(${settings.hue} 100% 62%)`);
  document.body.style.setProperty("--teleport-duration", `${settings.duration}s`);
  document.getElementById("teleportHueValue").textContent = `${Math.round(settings.hue)}`;
  document.getElementById("teleportChargeValue").textContent = settings.charge.toFixed(2);
  document.getElementById("teleportPitchValue").textContent = formatSigned(settings.pitch, 1);
  document.getElementById("teleportSparkleValue").textContent = settings.sparkle.toFixed(2);
  document.getElementById("teleportDurationValue").textContent = `${settings.duration.toFixed(2)}s`;
  packet.textContent = JSON.stringify({
    workbench: "mage-teleport",
    trigger: "button.press",
    visual: {
      hue: settings.hue,
      charge: settings.charge,
      sparkle: settings.sparkle,
      durationSeconds: settings.duration,
      shape: settings.shape,
      particleCount: Math.round(80 + settings.charge * 160 + settings.sparkle * 90),
    },
    soemdspPatchIntent: {
      boundary: "browser preview only; translate to modules/patch later",
      gate: "momentary trigger",
      pitchSweepSemitones: settings.pitch,
      envelope: "fast charge, blink notch, shimmer tail",
      sources: ["sine sweep", "filtered noise sparkle", "short sub drop"],
      outputs: ["teleportSignAudio", "teleportSignVisualTrigger"],
    },
  }, null, 2);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function ensureAudioContext() {
  audioContext ||= new AudioContext();
  return audioContext;
}

function makeNoiseBuffer(context, seconds) {
  const length = Math.max(1, Math.round(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / length);
  }
  return buffer;
}

function triggerAudio(settings) {
  const context = ensureAudioContext();
  const now = context.currentTime;
  const duration = settings.duration;
  const out = context.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(0.48 + settings.charge * 0.36, now + 0.035);
  out.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  out.connect(context.destination);

  const carrier = context.createOscillator();
  const carrierGain = context.createGain();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(146.83 * 2 ** (settings.pitch / 12), now);
  carrier.frequency.exponentialRampToValueAtTime(1046.5 * (1 + settings.charge), now + duration * 0.42);
  carrier.frequency.exponentialRampToValueAtTime(220, now + duration);
  carrierGain.gain.setValueAtTime(0.0001, now);
  carrierGain.gain.exponentialRampToValueAtTime(0.42, now + 0.05);
  carrierGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  carrier.connect(carrierGain).connect(out);
  carrier.start(now);
  carrier.stop(now + duration + 0.05);

  const shimmer = context.createBufferSource();
  const shimmerFilter = context.createBiquadFilter();
  const shimmerGain = context.createGain();
  shimmer.buffer = makeNoiseBuffer(context, duration);
  shimmerFilter.type = "bandpass";
  shimmerFilter.frequency.setValueAtTime(900 + settings.sparkle * 3600, now);
  shimmerFilter.Q.setValueAtTime(5 + settings.sparkle * 18, now);
  shimmerGain.gain.setValueAtTime(0.0001, now);
  shimmerGain.gain.exponentialRampToValueAtTime(0.16 + settings.sparkle * 0.34, now + duration * 0.16);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  shimmer.connect(shimmerFilter).connect(shimmerGain).connect(out);
  shimmer.start(now);
  shimmer.stop(now + duration + 0.05);

  const sub = context.createOscillator();
  const subGain = context.createGain();
  sub.type = "triangle";
  sub.frequency.setValueAtTime(95, now + duration * 0.38);
  sub.frequency.exponentialRampToValueAtTime(36, now + duration * 0.72);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.exponentialRampToValueAtTime(0.28 * settings.charge, now + duration * 0.45);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  sub.connect(subGain).connect(out);
  sub.start(now + duration * 0.34);
  sub.stop(now + duration + 0.05);
}

function spawnParticles(settings) {
  resizeCanvas();
  burstSerial += 1;
  const count = Math.round(80 + settings.charge * 160 + settings.sparkle * 90);
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.55;
  const baseRadius = Math.min(canvas.width, canvas.height) * 0.12;
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const lane = settings.shape === "column"
      ? (Math.random() - 0.5) * 0.28
      : settings.shape === "scatter"
        ? Math.random()
        : 0.72 + Math.random() * 0.32;
    const speed = (120 + Math.random() * 620) * (0.45 + settings.charge);
    const ringX = centerX + Math.cos(angle) * baseRadius * lane;
    const ringY = centerY + Math.sin(angle) * baseRadius * lane * 0.24;
    particles.push({
      serial: burstSerial,
      x: settings.shape === "column" ? centerX + (Math.random() - 0.5) * baseRadius : ringX,
      y: settings.shape === "column" ? centerY + (Math.random() - 0.5) * baseRadius * 2 : ringY,
      vx: Math.cos(angle) * speed * (settings.shape === "ring" ? -0.32 : 0.48),
      vy: Math.sin(angle) * speed * (settings.shape === "column" ? -1.1 : 0.28) - settings.charge * 160,
      life: settings.duration * (0.5 + Math.random() * 0.68),
      age: 0,
      size: 1.3 + Math.random() * (2.5 + settings.sparkle * 4),
      hue: settings.hue + (Math.random() - 0.5) * 42,
      alpha: 0.45 + Math.random() * 0.5,
    });
  }
}

function castTeleport() {
  const settings = readSettings();
  updateOutputs();
  document.body.classList.remove("teleporting");
  void document.body.offsetWidth;
  document.body.classList.add("teleporting");
  window.setTimeout(() => document.body.classList.remove("teleporting"), settings.duration * 1000);
  spawnParticles(settings);
  triggerAudio(settings);
}

// Native GL on the shared device: one batch per frame (background bands,
// stars, glowing particles), presented to the canvas.
const BACKGROUND_STOPS = [[0, [5, 7, 13]], [0.58, [7, 9, 7]], [1, [9, 11, 7]]];

function backgroundAt(t) {
  for (let i = 1; i < BACKGROUND_STOPS.length; i += 1) {
    const [t1, c1] = BACKGROUND_STOPS[i];
    const [t0, c0] = BACKGROUND_STOPS[i - 1];
    if (t <= t1) {
      const u = (t - t0) / Math.max(1e-6, t1 - t0);
      return c0.map((c, k) => (c + (c1[k] - c) * u) / 255);
    }
  }
  return BACKGROUND_STOPS[BACKGROUND_STOPS.length - 1][1].map((c) => c / 255);
}

function drawBackground(batch, width, height) {
  const bands = 48;
  for (let i = 0; i < bands; i += 1) {
    const y0 = (i / bands) * height;
    const y1 = ((i + 1) / bands) * height;
    nodeGraphGlLinesRect(batch, 0, y0, width, y1 - y0 + 1, [...backgroundAt((i + 0.5) / bands), 1]);
  }
  for (let index = 0; index < 74; index += 1) {
    const x = (index * 719) % width;
    const y = (index * 313) % Math.max(1, height * 0.58);
    const size = 0.8 + (index % 5) * 0.22;
    const alpha = 0.72 * (0.2 + (index % 7) * 0.06);
    nodeGraphGlLinesRect(batch, x, y, size, size, [239 / 255, 246 / 255, 230 / 255, alpha]);
  }
}

function drawParticles(batch, dt) {
  particles = particles.filter((particle) => particle.age < particle.life);
  for (const particle of particles) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.986;
    particle.vy = particle.vy * 0.986 + 80 * dt;
    const t = clamp(particle.age / particle.life, 0, 1);
    const alpha = particle.alpha * (1 - t);
    const radius = particle.size * (1 + t * 1.8);
    // Glow (was shadowBlur = size * 5): a feathered halo under the core.
    const glow = nodeGraphGlLinesCss(`hsl(${particle.hue}, 100%, 66%)`, alpha * 0.6);
    nodeGraphGlLinesDot(batch, particle.x, particle.y, radius, particle.size * 2.5, glow);
    const core = nodeGraphGlLinesCss(`hsl(${particle.hue}, 100%, ${62 + 20 * (1 - t)}%)`, alpha);
    nodeGraphGlLinesDot(batch, particle.x, particle.y, Math.max(0, radius - 0.5), 1, core);
  }
}

function animate(time) {
  resizeCanvas();
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;
  const batch = nodeGraphGlLinesBegin(canvas, [...backgroundAt(0), 1], { publishNodeId: "" });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "teleport workbench: no shared GL device");
    return;
  }
  drawBackground(batch, canvas.width, canvas.height);
  drawParticles(batch, dt);
  if (!nodeGraphGlLinesEnd(batch)) {
    nodeGraphDisplayGlFailed(canvas, "teleport workbench: GL present failed");
    return;
  }
  requestAnimationFrame(animate);
}

for (const element of Object.values(controls)) {
  element.addEventListener("input", updateOutputs);
}

castButton.addEventListener("click", castTeleport);
window.addEventListener("resize", resizeCanvas);

updateOutputs();
resizeCanvas();
requestAnimationFrame(animate);
