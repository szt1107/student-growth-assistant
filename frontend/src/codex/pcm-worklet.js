class PCMInput extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; this.position = 0; this.output = []
    this.port.onmessage = () => { this.flush(); this.port.postMessage('flushed') }
  }
  flush() {
    if (!this.output.length) return
    const buffer = new ArrayBuffer(this.output.length * 2), view = new DataView(buffer)
    this.output.forEach((value, i) => view.setInt16(i * 2, value, true))
    this.port.postMessage(buffer, [buffer]); this.output = []
  }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    this.samples.push(...channel)
    const ratio = sampleRate / 16000
    while (this.position + ratio < this.samples.length) {
      const start = Math.floor(this.position), end = Math.floor(this.position + ratio)
      let value = 0
      for (let i = start; i < end; i++) value += this.samples[i]
      value = Math.max(-1, Math.min(1, value / Math.max(1, end - start)))
      this.output.push(value < 0 ? value * 32768 : value * 32767)
      this.position += ratio
      if (this.output.length === 1600) {
        this.flush()
      }
    }
    const consumed = Math.floor(this.position)
    this.samples.splice(0, consumed); this.position -= consumed
    return true
  }
}
registerProcessor('pcm-input', PCMInput)
