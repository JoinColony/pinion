class CachedStore {
  constructor(orbitStore, onTimeout) {
    this.orbitStore = orbitStore;
    this.onTimeout = onTimeout;
    this.timeout = setTimeout(
      () => this.onTimeout(),
      Number(process.env.OPEN_STORE_TIMEOUT_MS) || 10000,
    );
  }

  clearEvictionTimeout() {
    if (this.timeout) clearTimeout(this.timeout);
  }

  resetTTL() {
    this.clearEvictionTimeout();
    this.timeout = setTimeout(
      () => this.onTimeout(),
      Number(process.env.OPEN_STORE_TIMEOUT_MS) || 10000,
    );
  }
}

module.exports = CachedStore;