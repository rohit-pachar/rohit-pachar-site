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
  const botEls = new Map();

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
  function ensurePlayback() {
    if (playCtx) return playCtx.resume();
    playCtx = new (window.AudioContext || window.webkitAudioContext)();
    outGain = playCtx.createGain();
    outAnalyser = playCtx.createAnalyser();
    outAnalyser.fftSize = 512;
    outGain.connect(outAnalyser);
    outAnalyser.connect(playCtx.destination);
    return playCtx.resume();
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
    if (state === "speaking") setState(ws && ws.readyState === 1 ? "listening" : "idle");
  }

  // ------------------------------------------------------------ mic in
  async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    await micCtx.audioWorklet.addModule(new URL("mic-worklet.js", SCRIPT_URL).href);
    const srcNode = micCtx.createMediaStreamSource(micStream);
    micNode = new AudioWorkletNode(micCtx, "mic-processor");
    micNode.port.onmessage = ({ data }) => {
      micLevel = muted ? 0 : Math.min(1, data.rms * 6);
      if (!muted && ws && ws.readyState === 1) ws.send(data.pcm);
    };
    srcNode.connect(micNode);
    // Worklets only run when connected to the graph; route through a silent gain.
    const sink = micCtx.createGain();
    sink.gain.value = 0;
    micNode.connect(sink).connect(micCtx.destination);
    micOn = true;
    ui.mute.disabled = false;
  }

  function stopMic() {
    micOn = false;
    micLevel = 0;
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (micCtx) micCtx.close();
    micStream = micCtx = micNode = null;
    ui.mute.disabled = true;
    muted = false;
    ui.mute.setAttribute("aria-pressed", "false");
  }

  // ------------------------------------------------------------ socket
  function connect({ greet }) {
    return new Promise((resolve, reject) => {
      setState("connecting");
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "hello", greet }));
        startedAt = Date.now();
        clearInterval(timerHandle);
        timerHandle = setInterval(tickTimer, 1000);
        setState("listening");
        resolve();
      };
      ws.onerror = () => reject(new Error("Could not reach the voice server."));
      ws.onclose = (e) => {
        const wasLive = state !== "idle";
        ws = null;
        clearInterval(timerHandle);
        stopPlayback();
        stopMic();
        setTalkButton(false);
        setState("idle");
        if (wasLive && e.code !== 1000) {
          const why = e.code === 4403 ? "This page isn't allowed to use the voice server." :
                      e.code === 4429 ? "Lots of people are talking to me right now. Try again in a minute." :
                      "Connection closed.";
          addMsg("sys", why);
        }
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") {
          const turn = new DataView(ev.data).getUint32(0, true);
          playPcm(turn, ev.data.slice(4));
          return;
        }
        handle(JSON.parse(ev.data));
      };
    });
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
      case "bot_delta": {
        if (m.turn <= cancelledUpTo) break;
        let el = botEls.get(m.turn);
        if (!el) { el = addMsg("rohit", ""); botEls.set(m.turn, el); }
        const t = el.querySelector(".t");
        t.textContent += m.text;
        setCaption(t.textContent.trim(), "rohit");
        ui.log.scrollTop = ui.log.scrollHeight;
        break;
      }
      case "interrupt": {
        const wasPlaying = sources.size > 0 || !turnEnded.has(m.turn);
        cancelledUpTo = Math.max(cancelledUpTo, m.turn);
        stopPlayback();
        const el = botEls.get(m.turn);
        if (el && wasPlaying) el.classList.add("cut");
        if (state === "speaking") setState("listening");
        break;
      }
      case "turn_end":
        turnEnded.add(m.turn);
        if (!sources.size && state !== "speaking" && m.turn === currentTurn) setState("listening");
        break;
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

  async function startTalking() {
    try {
      await ensurePlayback();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the microphone here (it needs HTTPS).");
      await startMic();
      if (!ws) await connect({ greet: true });
      setTalkButton(true);
      setState("listening");
    } catch (err) {
      stopMic();
      setState("error");
      addMsg("sys", err.name === "NotAllowedError" ? "Microphone access was blocked. You can still type below." : err.message || String(err));
    }
  }

  function endConversation() {
    if (ws) ws.close(1000);
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
      if (!ws) await connect({ greet: false });
      stopPlayback();
      ws.send(JSON.stringify({ type: "text", text }));
    } catch (err) {
      setState("error");
      addMsg("sys", err.message || String(err));
    }
  }

  ui.talk.onclick = () => (micOn ? endConversation() : startTalking());
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

    ui.portrait.style.transform = `scale(${1 + smooth * 0.035})`;
    bars.forEach((b, i) => {
      const v = micOn && !muted ? micLevel * (0.5 + 0.5 * Math.abs(Math.sin(phase * 4 + i))) : 0;
      b.style.height = `${3 + v * 19}px`;
    });
  }

  renderChips();
  requestAnimationFrame(frame);
})();
