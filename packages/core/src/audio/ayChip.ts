/** AY-3-8912 sound chip (128K/+2/+3): 3 square-wave tone generators, one shared
 * noise generator, one envelope generator, register-selected via ports 0xFFFD
 * (select/read) and 0xBFFD (data write). Unlike the frame-scoped Beeper, this is a
 * free-running oscillator whose internal counters persist across frames — driven by
 * its own clock via a fractional accumulator, not by T-states, so pitch stays
 * correct regardless of host frame/sample-rate boundaries. */

/** The 128K Spectrum's AY clock: CPU clock (3.5469 MHz) / 2. */
export const AY_CLOCK_HZ = 1773400;

/** Coarse log-ish approximation of the AY's resistor-ladder DAC (not chip-measured
 * — real hardware has slightly uneven per-step spacing). ponytail: swap for a
 * measured 16-step table if exact timbre matching against real hardware matters. */
function buildVolumeTable(): Float32Array {
  const table = new Float32Array(16);
  for (let level = 1; level < 16; level++) {
    table[level] = Math.pow(2, (level - 15) / 2);
  }
  return table;
}
const VOLUME_TABLE = buildVolumeTable();

const REGISTER_COUNT = 14; // R0-R13; R14/R15 (I/O ports) aren't wired on the Spectrum

export class AyChip {
  private readonly registers = new Uint8Array(REGISTER_COUNT);
  private selectedRegister = 0;

  private readonly tonePeriod = [1, 1, 1];
  private readonly toneCounter = [0, 0, 0];
  private readonly toneOutput: (0 | 1)[] = [0, 0, 0];

  private noisePeriod = 1;
  private noiseCounter = 0;
  private noiseShift = 1; // 17-bit LFSR, must never settle at 0
  private noiseOutput: 0 | 1 = 0;

  private envelopePeriod = 1;
  private envelopeCounter = 0;
  private envelopeStep = 0; // 0-15 within the current ramp
  private envelopeAscending = false;
  private envelopeHolding = false;
  private envelopeLevel = 0;

  private clockAccumulator = 0;

  reset(): void {
    this.registers.fill(0);
    this.selectedRegister = 0;
    this.tonePeriod.fill(1);
    this.toneCounter.fill(0);
    this.toneOutput.fill(0);
    this.noisePeriod = 1;
    this.noiseCounter = 0;
    this.noiseShift = 1;
    this.noiseOutput = 0;
    this.envelopePeriod = 1;
    this.envelopeCounter = 0;
    this.envelopeStep = 0;
    this.envelopeAscending = false;
    this.envelopeHolding = false;
    this.envelopeLevel = 0;
    this.clockAccumulator = 0;
  }

  /** Port 0xFFFD write: selects the register subsequent data writes/reads target. */
  selectRegister(value: number): void {
    this.selectedRegister = value & 0x0f;
  }

  /** Port 0xBFFD write: writes to the currently selected register. */
  writeData(value: number): void {
    const reg = this.selectedRegister;
    if (reg >= REGISTER_COUNT) return; // R14/R15 (I/O ports): not modeled
    this.registers[reg] = value & 0xff;
    this.recomputePeriods();
    if (reg === 13) this.restartEnvelope();
  }

  /** Port 0xFFFD read: the currently selected register's value. */
  readData(): number {
    return this.selectedRegister < REGISTER_COUNT ? this.registers[this.selectedRegister]! : 0xff;
  }

  /** Loads all 14 registers directly (snapshot loading) and restarts the envelope,
   * matching what a real chip does the moment R13 is (re)written. */
  loadRegisters(values: Uint8Array): void {
    for (let i = 0; i < REGISTER_COUNT; i++) this.registers[i] = values[i] ?? 0;
    this.recomputePeriods();
    this.restartEnvelope();
  }

  private recomputePeriods(): void {
    for (let ch = 0; ch < 3; ch++) {
      const fine = this.registers[ch * 2]!;
      const coarse = this.registers[ch * 2 + 1]! & 0x0f;
      this.tonePeriod[ch] = ((coarse << 8) | fine) || 1;
    }
    this.noisePeriod = (this.registers[6]! & 0x1f) || 1;
    const envFine = this.registers[11]!;
    const envCoarse = this.registers[12]!;
    this.envelopePeriod = ((envCoarse << 8) | envFine) || 1;
  }

  /** Writing R13 always restarts the envelope generator from the start of its ramp
   * (real chip behavior), regardless of what value was written. */
  private restartEnvelope(): void {
    const attack = (this.registers[13]! & 0x04) !== 0;
    this.envelopeCounter = 0;
    this.envelopeStep = 0;
    this.envelopeHolding = false;
    this.envelopeAscending = attack;
    this.envelopeLevel = attack ? 0 : 15;
  }

  /** Advances every generator by one AY clock cycle. */
  private tick(): void {
    for (let ch = 0; ch < 3; ch++) {
      this.toneCounter[ch]!++;
      if (this.toneCounter[ch]! >= this.tonePeriod[ch]! * 8) {
        this.toneCounter[ch] = 0;
        this.toneOutput[ch] = this.toneOutput[ch] ? 0 : 1;
      }
    }

    this.noiseCounter++;
    if (this.noiseCounter >= this.noisePeriod * 16) {
      this.noiseCounter = 0;
      this.noiseOutput = (this.noiseShift & 1) as 0 | 1;
      // 17-bit Fibonacci LFSR, taps at bits 0 and 3 (standard AY noise polynomial).
      const bit = (this.noiseShift ^ (this.noiseShift >> 3)) & 1;
      this.noiseShift = (this.noiseShift >> 1) | (bit << 16);
    }

    if (this.envelopeHolding) return;
    this.envelopeCounter++;
    if (this.envelopeCounter >= this.envelopePeriod * 8) {
      this.envelopeCounter = 0;
      this.advanceEnvelopeStep();
    }
  }

  private advanceEnvelopeStep(): void {
    this.envelopeStep++;
    if (this.envelopeStep <= 15) {
      this.envelopeLevel = this.envelopeAscending ? this.envelopeStep : 15 - this.envelopeStep;
      return;
    }

    const shape = this.registers[13]!;
    const continueShape = (shape & 0x08) !== 0;
    const alternate = (shape & 0x02) !== 0;
    const hold = (shape & 0x01) !== 0;

    if (!continueShape) {
      // Datasheet: CONT=0 shapes all decay to and hold at 0 after one ramp,
      // regardless of the attack direction or the ALT/HOLD bits.
      this.envelopeHolding = true;
      this.envelopeLevel = 0;
      return;
    }
    if (hold) {
      this.envelopeHolding = true;
      this.envelopeLevel = this.envelopeAscending ? 15 : 0;
      return;
    }

    this.envelopeStep = 0;
    if (alternate) this.envelopeAscending = !this.envelopeAscending;
    this.envelopeLevel = this.envelopeAscending ? 0 : 15;
  }

  /** Renders `sampleCount` samples at `sampleRate`, mixing all three channels as
   * bipolar square waves (each ±volume, so a channel idles at 0 on average).
   * Output is in [-1, 1]. Internal generator state persists across calls. */
  renderFrame(sampleCount: number, sampleRate: number): Float32Array {
    const out = new Float32Array(sampleCount);
    const mixer = this.registers[7]!;

    for (let i = 0; i < sampleCount; i++) {
      this.clockAccumulator += AY_CLOCK_HZ;
      while (this.clockAccumulator >= sampleRate) {
        this.clockAccumulator -= sampleRate;
        this.tick();
      }

      let sample = 0;
      for (let ch = 0; ch < 3; ch++) {
        const toneEnabled = (mixer & (1 << ch)) === 0;
        const noiseEnabled = (mixer & (1 << (3 + ch))) === 0;
        const toneBit = toneEnabled ? this.toneOutput[ch]! : 1;
        const noiseBit = noiseEnabled ? this.noiseOutput : 1;
        const combined = toneBit & noiseBit;

        const volReg = this.registers[8 + ch]!;
        const level = (volReg & 0x10) !== 0 ? this.envelopeLevel : volReg & 0x0f;
        const amplitude = VOLUME_TABLE[level]!;
        sample += combined ? amplitude : -amplitude;
      }
      out[i] = sample / 3;
    }

    return out;
  }
}

export { REGISTER_COUNT as AY_REGISTER_COUNT };
