import { NEUTRAL, validControls, validSequence, SIM_HZ, INPUT_HZ } from '../src/online/protocol.js';
import { PublicError } from './limits.mjs';
export const COMMAND_TICKS = SIM_HZ / INPUT_HZ;
// The SERVER assigns duration. Sending more commands cannot buy simulation time.
// A short startup buffer preserves press/release edges when packets arrive together.
export class InputStream {
    constructor({ staleMs = 250, maxCommands = 32 } = {}) {
        this.staleMs = staleMs;
        this.maxCommands = maxCommands;
        this.queue = [];
        this.lastSequence = 0;
        this.seq = 0;
        this.ticks = COMMAND_TICKS;
        this.controls = NEUTRAL;
        this.lastArrival = -Infinity;
        this.firstArrival = null;
        this.started = false;
        this.idle = 0;
        this.underruns = 0;
        this.discarded = 0;
        this.rebases = 0;
    }
    push(seq, controls, now) {
        if (!validSequence(seq) || !validControls(controls) || seq > this.lastSequence + 2400)
            throw new PublicError('invalid_input');
        if (seq <= this.lastSequence)
            return false;
        if (this.queue.length >= this.maxCommands)
            throw new PublicError('input_backlog');
        this.lastSequence = seq;
        this.lastArrival = now;
        this.firstArrival ??= now;
        this.queue.push({ seq, controls: [...controls] });
        return true;
    }
    step(now) {
        if (now - this.lastArrival > this.staleMs) {
            this.clear();
            return NEUTRAL;
        }
        // After a TCP stall, do not execute a long backlog of obsolete steering.
        // Drop old commands rather than speeding up authoritative simulation.
        if (this.queue.length > 6) {
            const dropped = this.queue.splice(0, this.queue.length - 2);
            this.discarded += dropped.length;
            this.seq = dropped.at(-1).seq;
            this.ticks = COMMAND_TICKS;
            this.rebases++;
        }
        if (!this.started) {
            if (this.queue.length < 2 && now - this.firstArrival < 1000 / INPUT_HZ)
                return NEUTRAL;
            this.started = true;
        }
        if (this.ticks >= COMMAND_TICKS && this.queue.length) {
            const command = this.queue.shift();
            this.seq = command.seq;
            this.controls = command.controls;
            this.ticks = 0;
            this.idle = 0;
        }
        if (this.ticks < COMMAND_TICKS)
            this.ticks++;
        else {
            this.idle = Math.min(65535, this.idle + 1);
            this.underruns++;
        }
        return this.controls;
    }
    clear() {
        this.discarded += this.queue.length;
        this.queue.length = 0;
        this.seq = this.lastSequence;
        this.ticks = COMMAND_TICKS;
        this.controls = NEUTRAL;
        this.firstArrival = null;
        this.started = false;
        this.idle = 0;
    }
    metadata() { return { seq: this.seq, ticks: this.ticks, queued: this.queue.length * COMMAND_TICKS + Math.max(0, COMMAND_TICKS - this.ticks), idle: this.idle, controls: this.controls }; }
}
