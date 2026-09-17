export class TokenBucket {
  constructor(rate, burst, now = performance.now()) { this.rate = rate; this.burst = burst; this.tokens = burst; this.last = now; }
  take(now = performance.now(), cost = 1) {
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.last) * this.rate / 1000); this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost; return true;
  }
}
export class BoundedRates {
  constructor(maximum = 4096) { this.maximum = maximum; this.items = new Map(); }
  take(key, rate, burst, now = performance.now()) {
    let entry = this.items.get(key);
    if (!entry) {
      this.sweep(now);
      if (this.items.size >= this.maximum) return false;
      this.items.set(key, entry = new TokenBucket(rate, burst, now));
    }
    return entry.take(now);
  }
  sweep(now = performance.now()) { for (const [key, bucket] of this.items) if (now - bucket.last > 300000) this.items.delete(key); }
}
export class PublicError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
