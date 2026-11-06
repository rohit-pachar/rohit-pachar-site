(() => {
  "use strict";

  // Resolve sibling files (the mic worklet) against this script, not the page URL:
  // the page may be served as /talk or /talk/.
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || document.baseURI;

  const QUESTIONS = [
    "What should we know about your life story in a few sentences?",
    "What's your #1 superpower?",
    "What are the top 3 areas you'd like to grow in?",
    "What misconception do your coworkers have about you?",
    "How do you push your boundaries and limits?",
  ];

  const $ = (id) => document.getElementById(id);
  const ui = {
    status: $("status"), statusText: $("statusText"), caption: $("caption"), log: $("log"),
    chips: $("chips"), talk: $("talk"), talkLabel: $("talkLabel"), mute: $("mute"),
    form: $("typeForm"), input: $("typeInput"), meter: $("meter"), timer: $("timer"),
    portrait: $("portrait"), orb: $("orb"),
  };

  const wsUrl = (() => {
    if (window.VOICE_ROHIT_WS) return window.VOICE_ROHIT_WS;
    const base = location.pathname.replace(/[^/]*$/, "");
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${base}ws`;
  })();

  // ------------------------------------------------------------ state
  let ws = null;
  let state = "idle"; // idle | connecting | listening | thinking | speaking | error
  let micOn = false, muted = false;
  let micCtx = null, micStream = null, micNode = null;
  let playCtx = null, outGain = null, outAnalyser = null;
  let nextTime = 0;
  const sources = new Set();
  let cancelledUpTo = 0; // drop audio for turns <= this
  let currentTurn = 0;
  const turnEnded = new Set();
  let micLevel = 0, outLevel = 0;
  let startedAt = 0, timerHandle = null;
  let partialEl = null;
  // Per bot turn: full text so far + when its audio started, so words can be revealed in
  // step with the voice instead of all at once.
  const bot = new Map(); // turn -> { el, text, startAt, audioSec, frozen }
  function botTurn(turn) {
    let b = bot.get(turn);
    if (!b) { b = { el: null, text: "", startAt: null, audioSec: 0, frozen: false, shown: -1 }; bot.set(turn, b); }
    return b;
  }

  // ------------------------------------------------------------ UI helpers
  const LABELS = { idle: "Offline", connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Speaking", error: "Error" };
  function setState(s) {
    state = s;
    ui.status.dataset.s = s;
    ui.statusText.textContent = s === "listening" && !micOn ? "Ready" : s === "listening" && muted ? "Muted" : LABELS[s];
  }

  // The caption is a 3-line "now speaking" strip, so show the tail of long replies.
  function setCaption(text, who) {
    ui.caption.className = "caption" + (who === "you" ? " you" : "");
    if (text.length > 120) {
      const cut = text.slice(-120);
      text = "…" + cut.slice(cut.indexOf(" ") + 1);
    }
    ui.caption.textContent = text;
  }

  function clearEmpty() {
    const e = ui.log.querySelector(".empty");
    if (e) e.remove();
  }

  function addMsg(who, text, cls = "") {
    clearEmpty();
    const el = document.createElement("div");
    el.className = `msg ${who} ${cls}`.trim();
    el.innerHTML = `<div class="mono who">${who === "you" ? "You" : who === "rohit" ? "Rohit" : "·"}</div><div class="t"></div>`;
    el.querySelector(".t").textContent = text;
    ui.log.appendChild(el);
    ui.log.scrollTop = ui.log.scrollHeight;
    return el;
  }

  function renderChips() {
    ui.chips.innerHTML = "";
    for (const q of QUESTIONS) {
      const b = document.createElement("button");
      b.className = "chip";
      b.type = "button";
      b.textContent = q;
      b.onclick = () => ask(q);
      ui.chips.appendChild(b);
    }
  }

  function tickTimer() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    ui.timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  // ------------------------------------------------------------ audio out
  async function ensurePlayback() {
    if (!playCtx || playCtx.state === "closed") {
      playCtx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = playCtx.createGain();
      outAnalyser = playCtx.createAnalyser();
      outAnalyser.fftSize = 512;
      outGain.connect(outAnalyser);
      outAnalyser.connect(playCtx.destination);
    }
    // After the tab sits idle the browser may suspend audio; resume, but never hang on it.
    if (playCtx.state !== "running") await withTimeout(playCtx.resume(), 2000).catch(() => {});
  }

  function withTimeout(promise, ms, message) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(message || "timeout")), ms))]);
  }

  function playPcm(turn, bytes) {
    if (turn <= cancelledUpTo || !playCtx) return;
    const pcm = new Int16Array(bytes);
    if (!pcm.length) return;
    const buf = playCtx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = playCtx.createBufferSource();
    src.buffer = buf;
    src.connect(outGain);
    const at = Math.max(nextTime, playCtx.currentTime + 0.04);
    src.start(at);
    nextTime = at + buf.duration;
    const b = botTurn(turn);
    if (b.startAt === null) b.startAt = at;
    b.audioSec = at + buf.duration - b.startAt;
    src._turn = turn;
    sources.add(src);
    setState("speaking");
    src.onended = () => {
      sources.delete(src);
      if (!sources.size) afterPlayback();
    };
  }

  function stopPlayback() {
    for (const s of sources) { try { s.onended = null; s.stop(); } catch {} }
    sources.clear();
    nextTime = 0;
  }

  function afterPlayback() {
    // Brief gaps between sentences empty the queue too; only settle once the reply is complete.
    if (state === "speaking" && turnEnded.has(currentTurn)) setState(ws && ws.readyState === 1 ? "listening" : "idle");
  }

  // ------------------------------------------------------------ mic in
  // One AudioContext with the worklet loaded, created once and reused for every session.
  // (Creating/closing a context per click raced with double-clicks and broke the mic.)
  let micCtxReady = null;
  let micSrc = null;

  function getMicCtx() {
    if (!micCtxReady) {
      micCtxReady = (async () => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        await ctx.audioWorklet.addModule(new URL("mic-worklet.js", SCRIPT_URL).href);
        return ctx;
      })();
      micCtxReady.catch(() => { micCtxReady = null; }); // allow a retry
    }
    return micCtxReady;
  }

  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    try {
      const ctx = await getMicCtx();
      if (ctx.state === "closed") { micCtxReady = null; throw new Error("audio context closed"); }
      if (ctx.state !== "running") await withTimeout(ctx.resume(), 2000).catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "mic-processor");
      node.port.onmessage = ({ data }) => {
        micLevel = muted ? 0 : Math.min(1, data.rms * 6);
        if (!muted && ws && ws.readyState === 1) ws.send(data.pcm);
      };
      src.connect(node);
      // Worklets only run when connected to the graph; route through a silent gain.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      micCtx = ctx; micStream = stream; micSrc = src; micNode = node;
      micOn = true;
      ui.mute.disabled = false;
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }

  function stopMic() {
    micOn = false;
    micLevel = 0;
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (micNode) { micNode.port.onmessage = null; try { micNode.disconnect(); } catch {} }
    if (micSrc) { try { micSrc.disconnect(); } catch {} }
    micStream = micNode = micSrc = null; // the context itself is kept for the next start
    ui.mute.disabled = true;
    muted = false;
    ui.mute.setAttribute("aria-pressed", "false");
  }

  // ------------------------------------------------------------ socket
  function socketOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  function connect({ greet }) {
    // Drop a socket that died while the tab was idle.
    if (ws && ws.readyState !== WebSocket.OPEN) { try { ws.close(); } catch {} ws = null; }
    return new Promise((resolve, reject) => {
      setState("connecting");
      // The server numbers turns from 1 on every connection, so per-turn state from the
      // last connection must go, or new replies get dropped as "already cancelled".
      cancelledUpTo = 0; currentTurn = 0; turnEnded.clear(); bot.clear(); partialEl = null;
      const sock = new WebSocket(wsUrl);
      ws = sock;
      sock.binaryType = "arraybuffer";
      const timer = setTimeout(() => { try { sock.close(); } catch {} reject(new Error("unreachable")); }, 10000);
      sock.onopen = () => {
        clearTimeout(timer);
        sock.send(JSON.stringify({ type: "hello", greet }));
        startedAt = Date.now();
        clearInterval(timerHandle);
        timerHandle = setInterval(tickTimer, 1000);
        setState("listening");
        resolve();
      };
      sock.onerror = () => { clearTimeout(timer); reject(new Error("unreachable")); };
      sock.onclose = (e) => {
        clearTimeout(timer);
        if (ws !== sock) return; // an older socket closing late: leave the current one alone
        const wasLive = micOn || state === "speaking" || state === "thinking";
        ws = null;
        clearInterval(timerHandle);
        stopPlayback();
        stopMic();
        setTalkButton(false);
        setState("idle");
        if (e.code === 4408) note("I paused after a few quiet minutes. Press Start to keep talking.");
        else if (e.code === 4403) note("This page isn't allowed to use the voice server.");
        else if (e.code === 4429) note("Lots of people are talking to me right now. Try again in a minute.");
        else if (wasLive && e.code !== 1000) note("The connection dropped. Press Start to pick up again.");
      };
      sock.onmessage = (ev) => {
        if (ws !== sock) return;
        if (typeof ev.data !== "string") {
          const turn = new DataView(ev.data).getUint32(0, true);
          playPcm(turn, ev.data.slice(4));
          return;
        }
        handle(JSON.parse(ev.data));
      };
    });
  }

  // Friendly system notes; the raw error goes to the console for debugging.
  function note(text, err) {
    if (err) console.error(err);
    addMsg("sys", text);
  }

  function handle(m) {
    switch (m.type) {
      case "partial":
        setCaption(m.text, "you");
        if (!partialEl) partialEl = addMsg("you", m.text, "partial");
        else partialEl.querySelector(".t").textContent = m.text;
        ui.log.scrollTop = ui.log.scrollHeight;
        break;
      case "final":
        if (m.replace && !partialEl) {
          const mine = ui.log.querySelectorAll(".msg.you");
          if (mine.length) { mine[mine.length - 1].querySelector(".t").textContent = m.text; setCaption(m.text, "you"); setState("thinking"); break; }
        }
        if (partialEl) {
          partialEl.classList.remove("partial");
          partialEl.querySelector(".t").textContent = m.text;
          partialEl = null;
        } else {
          addMsg("you", m.text);
        }
        setCaption(m.text, "you");
        setState("thinking");
        break;
      case "speech_start":
        // Server heard the caller start talking (it also sends "interrupt" if Rohit was talking).
        if (state !== "speaking") { setState("listening"); setCaption("Listening…", "you"); }
        break;
      case "speech_end":
        if (state === "listening") setCaption("…", "you");
        break;
      case "turn_start":
        currentTurn = m.turn;
        break;
      case "bot_delta":
        if (m.turn > cancelledUpTo) botTurn(m.turn).text += m.text;  // revealed by syncText()
        break;
      case "interrupt": {
        const wasPlaying = sources.size > 0 || !turnEnded.has(m.turn);
        cancelledUpTo = Math.max(cancelledUpTo, m.turn);
        stopPlayback();
        const b = bot.get(m.turn);
        if (b) {
          b.frozen = true;  // keep only what was actually heard
          if (b.el && wasPlaying) b.el.classList.add("cut");
        }
        if (state === "speaking") setState("listening");
        break;
      }
      case "turn_end": {
        turnEnded.add(m.turn);
        const b = bot.get(m.turn);
        // No audio arrived (TTS failed): show the text anyway.
        if (b && b.startAt === null && b.text && !b.frozen) { b.startAt = -1; renderBot(b, b.text); }
        if (!sources.size && m.turn === currentTurn && (state === "speaking" || state === "thinking")) setState("listening");
        break;
      }
      case "error":
        addMsg("sys", m.message);
        if (state === "thinking") setState("listening");
        break;
    }
  }

  // ------------------------------------------------------------ actions
  function setTalkButton(live) {
    document.body.classList.toggle("live", live);
    ui.talk.classList.toggle("live", live);
    ui.talkLabel.innerHTML = live ? "End <span class=\"label-long\">conversation</span>" : "Start <span class=\"label-long\">talking</span>";
  }

  let starting = false;

  async function startTalking() {
    if (starting) return; // ignore double clicks while the mic/socket come up
    starting = true;
    ui.talk.disabled = true;
    setState("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no mic api"), { name: "NoMicApi" });
      await ensurePlayback();
      await startMic();
      if (!socketOpen()) await connect({ greet: true });
      setTalkButton(true);
      setState("listening");
    } catch (err) {
      stopMic();
      setTalkButton(false);
      setState("idle");
      if (err.name === "NotAllowedError") note("Microphone access is blocked. Allow it in the address bar, or type below.", err);
      else if (err.name === "NotFoundError") note("I couldn't find a microphone. You can still type below.", err);
      else if (err.name === "NoMicApi") note("This browser can't use the microphone here. You can still type below.", err);
      else if (err.message === "unreachable") note("I can't reach the voice server right now. Please try again in a moment.", err);
      else note("Something went wrong starting the mic. Please press Start again.", err);
    } finally {
      starting = false;
      ui.talk.disabled = false;
    }
  }

  function endConversation() {
    const sock = ws;
    ws = null;
    if (sock) sock.close(1000);
    clearInterval(timerHandle);
    stopMic();
    stopPlayback();
    setTalkButton(false);
    setState("idle");
    setCaption("Thanks for talking. Start again anytime.", "rohit");
  }

  async function ask(text) {
    text = text.trim();
    if (!text) return;
    try {
      await ensurePlayback();
      if (!socketOpen()) await connect({ greet: false });
      stopPlayback();
      ws.send(JSON.stringify({ type: "text", text }));
    } catch (err) {
      setState("idle");
      note("I can't reach the voice server right now. Please try again in a moment.", err);
    }
  }

  ui.talk.onclick = () => (micOn ? endConversation() : startTalking());
  // Coming back to the tab: if the socket died meanwhile, reset the UI so Start works first time.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ws && ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
      const sock = ws; ws = null;
      try { sock.close(); } catch {}
      stopMic(); stopPlayback(); setTalkButton(false); setState("idle");
    }
  });
  ui.mute.onclick = () => {
    muted = !muted;
    ui.mute.setAttribute("aria-pressed", String(muted));
    ui.mute.title = muted ? "Unmute mic" : "Mute mic";
    setState(state);
  };
  ui.form.onsubmit = (e) => {
    e.preventDefault();
    const v = ui.input.value;
    ui.input.value = "";
    ask(v);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sources.size && ws) ws.send(JSON.stringify({ type: "interrupt" }));
  });

  // ------------------------------------------------------------ text in sync with voice
  const FALLBACK_CPS = 14; // en-IN Chirp3-HD speaks ~14 characters/second

  function renderBot(b, text) {
    if (!b.el) b.el = addMsg("rohit", "");
    b.el.querySelector(".t").textContent = text;
    setCaption(text.trim(), "rohit");
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function syncText() {
    if (!playCtx) return;
    for (const [turn, b] of bot) {
      if (b.frozen || b.startAt === null || b.startAt < 0 || !b.text) continue;
      const played = Math.max(0, playCtx.currentTime - b.startAt);
      let n;
      if (turnEnded.has(turn) && b.audioSec > 0) {
        // Whole reply known: map audio time to text proportionally.
        n = played >= b.audioSec ? b.text.length : Math.floor(b.text.length * played / b.audioSec);
      } else {
        n = Math.floor(played * FALLBACK_CPS);
      }
      n = Math.min(n, b.text.length);
      // Finish the word in progress rather than cutting it mid-way.
      const sp = b.text.indexOf(" ", n);
      n = sp === -1 ? (n > 0 ? b.text.length : 0) : sp;
      if (n !== b.shown) { b.shown = n; renderBot(b, b.text.slice(0, n)); }
      if (n >= b.text.length && turnEnded.has(turn)) b.startAt = -1; // done
    }
  }

  // ------------------------------------------------------------ visuals
  const ctx = ui.orb.getContext("2d");
  const bars = [...ui.meter.children];
  const outData = new Uint8Array(256);
  let phase = 0, smooth = 0;

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function frame() {
    requestAnimationFrame(frame);
    if (outAnalyser && sources.size) {
      outAnalyser.getByteTimeDomainData(outData);
      let s = 0;
      for (const v of outData) s += ((v - 128) / 128) ** 2;
      outLevel = Math.min(1, Math.sqrt(s / outData.length) * 4);
    } else outLevel *= 0.9;

    const level = state === "speaking" ? outLevel : micLevel;
    smooth += (level - smooth) * 0.2;
    phase += 0.012 + smooth * 0.05;

    const dpr = window.devicePixelRatio || 1;
    const w = ui.orb.clientWidth, h = ui.orb.clientHeight;
    if (ui.orb.width !== w * dpr) { ui.orb.width = w * dpr; ui.orb.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, base = w * 0.29;

    const color = state === "speaking" ? cssVar("--accent") : state === "listening" && micOn && !muted ? cssVar("--you") : cssVar("--ink-3");

    // soft halo
    const g = ctx.createRadialGradient(cx, cy, base * 0.9, cx, cy, base * (1.25 + smooth * 0.5));
    g.addColorStop(0, color + "55");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, base * (1.3 + smooth * 0.5), 0, Math.PI * 2); ctx.fill();

    // wobbling rings
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      const amp = (3 + smooth * 26) * (1 - r * 0.25);
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 90) {
        const n = Math.sin(a * 3 + phase * (1.3 + r * 0.4)) * 0.6 + Math.sin(a * 5 - phase * (0.9 + r * 0.3)) * 0.4;
        const rad = base * (1.04 + r * 0.07) + n * amp;
        const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.75 - r * 0.22;
      ctx.lineWidth = 1.6 - r * 0.3;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // thinking: orbiting arc
    if (state === "thinking" || state === "connecting") {
      ctx.beginPath();
      ctx.arc(cx, cy, base * 1.2, phase * 3, phase * 3 + Math.PI * 0.5);
      ctx.strokeStyle = cssVar("--ink-2");
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    syncText();
    ui.portrait.style.transform = `scale(${1 + smooth * 0.035})`;
    bars.forEach((b, i) => {
      const v = micOn && !muted ? micLevel * (0.5 + 0.5 * Math.abs(Math.sin(phase * 4 + i))) : 0;
      b.style.height = `${3 + v * 19}px`;
    });
  }

  renderChips();
  requestAnimationFrame(frame);
})();
