/* PSY6 live capture core (v0.4.0) — lossless master-tap recording.
   Design decisions, stated honestly:
   - ScriptProcessorNode is DEPRECATED but universally supported
     (Chrome/Firefox/Safari). It is chosen deliberately: an AudioWorklet tap
     would need a module load + graph rework of the MAIN pooled engine —
     ScriptProcessor taps the existing output with zero graph changes.
   - Sample data accumulates in growable PREALLOCATED Float32 chunks
     (262144 frames ≈ 5.95 s @ 44.1 kHz): per-callback cost is one
     .set() copy — no per-callback allocation beyond the unavoidable
     chunk-reference list. Total frame counts are tracked in Float64
     (JS numbers) so hour-long jams cannot overflow int32 accounting.
   - The tap is PARALLEL to the listening path: analyser → tap → zero-gain
     sink. It never inserts itself into the live graph and is panic-safe:
     capture start/stop only flip flags — playback is never touched.
   - Quantization: start/stop land on the scheduler's 16-step bar grid
     (I.barHooks). stepsToBarBoundary() is the pure math the UI + G17 use.
*/
const SP_BUF = 1024; /* frames per audio callback — bounds quantization skew: start+stop overshoot ≤ 2×1024/44100 ≈ 46 ms < the ±50 ms G17 tolerance */

class GrowableChannel {
  constructor() { this.chunks = []; this.cur = null; this.pos = 0; this.len = 0; }
  write(src) {
    let off = 0;
    while (off < src.length) {
      if (!this.cur || this.pos >= this.cur.length) {
        this.cur = new Float32Array(CaptureTap.CHUNK);
        this.chunks.push(this.cur); this.pos = 0;
      }
      const n = Math.min(src.length - off, this.cur.length - this.pos);
      this.cur.set(src.subarray(off, off + n), this.pos);
      this.pos += n; off += n;
    }
    this.len += src.length;
  }
  /* assemble into ONE Float32Array (called once, on capture stop) */
  concat() {
    const out = new Float32Array(this.len);
    let o = 0;
    for (const c of this.chunks) {
      const n = Math.min(c.length, this.len - o);
      out.set(c.subarray(0, n), o); o += n;
    }
    return out;
  }
}

class CaptureTap {
  constructor(ctx, source) {
    this.ctx = ctx;
    this.chunks = [new GrowableChannel(), new GrowableChannel()];
    this.recording = false;
    this.frames = 0; /* Float64-tracked */
    this.proc = ctx.createScriptProcessor(SP_BUF, 2, 2);
    this.sink = ctx.createGain(); this.sink.gain.value = 0; /* tap must not be audible */
    this.proc.onaudioprocess = (e) => {
      const ib = e.inputBuffer, ob = e.outputBuffer;
      for (let c = 0; c < ob.numberOfChannels; c++) {
        ob.getChannelData(c).set(ib.getChannelData(Math.min(c, ib.numberOfChannels - 1)));
      }
      if (this.recording) {
        this.chunks[0].write(ib.getChannelData(0));
        this.chunks[1].write(ib.getChannelData(Math.min(1, ib.numberOfChannels - 1)));
        this.frames += ib.length;
      }
    };
    source.connect(this.proc);
    this.proc.connect(this.sink);
    this.sink.connect(ctx.destination); /* Chrome only runs the callback when connected to a destination */
  }
  start() { this.recording = true; }
  stop() { this.recording = false; }
  assemble() { return [this.chunks[0].concat(), this.chunks[1].concat()]; }
  dispose() { try { this.proc.disconnect(); this.sink.disconnect(); } catch (e) { /* done */ } }
}
CaptureTap.CHUNK = 262144;

/* pure quantization math: steps until the next 16-step bar boundary,
   where "already on a boundary" means start NOW (0). */
function stepsToBarBoundary(step) {
  const m = ((step % 16) + 16) % 16;
  return m === 0 ? 0 : 16 - m;
}

export { CaptureTap, GrowableChannel, stepsToBarBoundary, SP_BUF };
