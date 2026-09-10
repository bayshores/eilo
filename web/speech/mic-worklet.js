class EiloMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.count = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.flush();
        this.port.postMessage({ flushed: true });
      }
    };
  }
  flush() {
    if (!this.count) return;
    const samples = new Float32Array(this.count);
    let offset = 0,
      sum = 0;
    for (const part of this.pending) {
      samples.set(part, offset);
      offset += part.length;
      for (const value of part) sum += value * value;
    }
    this.port.postMessage({ samples, level: Math.sqrt(sum / this.count) }, [samples.buffer]);
    this.pending = [];
    this.count = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      this.pending.push(new Float32Array(input));
      this.count += input.length;
      if (this.count >= 2048) this.flush();
    }
    return true;
  }
}
registerProcessor('eilo-microphone', EiloMicrophone);
