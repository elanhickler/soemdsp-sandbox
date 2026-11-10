// MIDI CC helpers — 7-bit is cc/128 so main*128 equals the 0..127 value.
// 14-bit is (MSB<<7|LSB)/16384 so *128 stays on the same scale.
// Pitch bend is (raw-8192)/8192 (-1..+1). Pressure is value/128.
(function (root) {
  const CC_PITCH_BEND = 128;
  const CC_CHANNEL_PRESSURE = 129;
  const CC_POLY_AFTERTOUCH = 130;

  function clamp127(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(127, n));
  }

  function sevenBit(value) {
    return clamp127(value) / 128;
  }

  function fourteenBit(msb, lsb) {
    const hi = clamp127(msb);
    const lo = clamp127(lsb);
    return ((hi << 7) | lo) / 16384;
  }

  function pitchBend(raw14) {
    const raw = Math.max(0, Math.min(16383, Math.round(Number(raw14) || 0)));
    return (raw - 8192) / 8192;
  }

  function decodeMessage(status, data1, data2) {
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (command === 0xb0) {
      return { kind: "cc", channel, cc: clamp127(data1), value7: clamp127(data2) };
    }
    if (command === 0xe0) {
      const raw = (clamp127(data2) << 7) | clamp127(data1);
      return { kind: "bend", channel, cc: CC_PITCH_BEND, raw14: raw, value: pitchBend(raw) };
    }
    if (command === 0xd0) {
      return { kind: "pressure", channel, cc: CC_CHANNEL_PRESSURE, value: sevenBit(data1) };
    }
    if (command === 0xa0) {
      return { kind: "polyAt", channel, cc: CC_POLY_AFTERTOUCH, note: clamp127(data1), value: sevenBit(data2) };
    }
    return null;
  }

  function matchChannel(listenChannel, messageChannel) {
    const ch = Math.round(Number(listenChannel) || 0);
    if (ch <= 0) return true;
    return ch === messageChannel;
  }

  function applyToState(state, message, { channel, cc, highRes, learn } = {}) {
    const next = state && typeof state === "object" ? { ...state } : { msb: 0, lsb: 0 };
    if (!message) return { handled: false, state: next };

    if (learn) {
      if (message.kind === "cc") {
        return {
          handled: true,
          learned: true,
          channel: message.channel,
          cc: message.cc,
          value: sevenBit(message.value7),
          state: { msb: message.cc <= 31 ? message.value7 : next.msb, lsb: next.lsb },
        };
      }
      if (message.kind === "bend" || message.kind === "pressure" || message.kind === "polyAt") {
        return {
          handled: true,
          learned: true,
          channel: message.channel,
          cc: message.cc,
          value: message.value,
          state: next,
        };
      }
      return { handled: false, state: next };
    }

    if (!matchChannel(channel, message.channel)) {
      return { handled: false, state: next };
    }

    const want = Math.round(Number(cc) || 0);
    const fourteen = Boolean(highRes) && want >= 0 && want <= 31;

    if (message.kind === "cc") {
      if (fourteen && message.cc === want + 32) {
        next.lsb = message.value7;
        return { handled: true, value: fourteenBit(next.msb, next.lsb), state: next };
      }
      if (message.cc !== want) {
        return { handled: false, state: next };
      }
      if (fourteen) {
        next.msb = message.value7;
        return { handled: true, value: fourteenBit(next.msb, next.lsb), state: next };
      }
      return { handled: true, value: sevenBit(message.value7), state: next };
    }

    if (message.cc === want) {
      return { handled: true, value: message.value, state: next };
    }
    return { handled: false, state: next };
  }

  const api = {
    CC_PITCH_BEND,
    CC_CHANNEL_PRESSURE,
    CC_POLY_AFTERTOUCH,
    clamp127,
    sevenBit,
    fourteenBit,
    pitchBend,
    decodeMessage,
    matchChannel,
    applyToState,
  };
  root.SoemdspMidiCc = api;
  root.SoemdspMidiLag = api; // alias until leftover callers catch up
  if (typeof globalThis !== "undefined") {
    globalThis.SoemdspMidiCc = api;
    globalThis.SoemdspMidiLag = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
