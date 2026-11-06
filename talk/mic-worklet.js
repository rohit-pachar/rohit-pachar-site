// Captures mic audio, downsamples to 16 kHz mono PCM16 and posts 20 ms frames.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0; // fractional read position into the incoming stream
    this.prev = 0; // last sample of the previous block, for interpolation
    this.out = new Int16Array(320);
    this.n = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Linear-interpolating resampler from sampleRate -> 16 kHz.
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i === 0 ? this.prev : ch[i - 1];
      const b = ch[i];
      const s = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSq += s * s;
      if (this.n === this.out.length) {
        const rms = Math.sqrt(this.sumSq / this.n);
        this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]);
        this.out = new Int16Array(320);
        this.n = 0;
        this.sumSq = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    this.prev = ch[ch.length - 1];
    return true;
  }
}
registerProcessor("mic-processor", MicProcessor);
