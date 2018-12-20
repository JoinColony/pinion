const dotenv = require('dotenv');

if (process.env.NODE_ENV !== 'production') dotenv.config();

const EventEmitter = require('events');
const { Buffer } = require('buffer');

const debug = require('debug');
const ipfsClient = require('ipfs-http-client');
const isIPFS = require('is-ipfs');
const Cache = require('lru-cache');
const OrbitDB = require('orbit-db');
const PeerMonitor = require('ipfs-pubsub-peer-monitor');

const CachedStore = require('./cachedStore');
const { HAVE_HEADS, LOAD_STORE, PIN_HASH, PIN_STORE } = require('./actions');

const logError = debug('pinner:error');
const logDebug = debug('pinner:debug');
const logPubsub = debug('pinner:pubsub');

function closeStoreOnCacheEviction(address, cachedStore) {
  logDebug(`Cleaning up and closing store "${address}"!`);
  if (!(cachedStore && cachedStore.orbitStore))
    return logError('Cached store is invalid');

  cachedStore.clearEvictionTimeout();
  return cachedStore.orbitStore
    .close()
    .then(() => logDebug(`Store "${address}" was closed...`));
}

/* TODO: we are using the permissive access controller for now, eventually we want to use our access controllers */
const permissiveAccessController = {
  canAppend() {
    return Promise.resolve(true);
  },
  grant() {},
  revoke() {},
  save() {},
  setup() {
    return Promise.resolve(true);
  },
};

class Pinner extends EventEmitter {
  constructor(room) {
    super();

    const { DAEMON_URL, OPEN_STORES_THRESHOLD } = process.env;
    this._ipfs = ipfsClient(DAEMON_URL || '/ip4/127.0.0.1/tcp/5001');
    this._room = room || 'COLONY_PINNING_ROOM';
    this._handleMessageBound = this._handleMessage.bind(this);

    this._cache = new Cache({
      max: Number(OPEN_STORES_THRESHOLD) || 1000,
      dispose: closeStoreOnCacheEviction,
    });
  }

  _publish(message) {
    const msgString = JSON.stringify(message);
    logPubsub(`Publishing: ${msgString}`);
    this._ipfs.pubsub.publish(this._room, Buffer.from(msgString));
  }

  _sendHeads(store) {
    this._publish({
      type: HAVE_HEADS,
      to: store.address,
      // eslint-disable-next-line no-underscore-dangle
      payload: { address: store.address, count: store._oplog._length },
    });
  }

  _handleNewPeer(peer) {
    logPubsub(`New peer: ${peer}`);
    this.emit('newpeer', peer);
  }

  _handleLeavePeer(peer) {
    logPubsub(`Peer left: ${peer}`);
    this.emit('peerleft', peer);
  }

  _handleMessage(message) {
    if (!(message && message.from && message.data)) {
      logError(new Error(`Message is invalid: ${message}`));
      return;
    }

    // Don't handle messages from ourselves
    if (message.from === this.id) return;
    logPubsub(`New Message from: ${message.from}`);
    logPubsub(message.data.toString());
    let action;
    try {
      action = JSON.parse(message.data);
    } catch (e) {
      logError(new Error(`Could not parse pinner message: ${message.data}`));
    }
    const { type, payload } = action;
    switch (type) {
      case PIN_HASH: {
        this.pinHash(payload);
        break;
      }
      case PIN_STORE: {
        this.pinStore(payload);
        break;
      }
      case LOAD_STORE: {
        this.loadStore(payload);
        break;
      }
      default:
        break;
    }
  }

  async init() {
    this.id = await this.getId();
    logDebug(`Pinner id: ${this.id}`);

    this._orbitNode = await OrbitDB.createInstance(this._ipfs, {
      directory: process.env.ORBITDB_PATH || './orbitdb',
    });

    await this._ipfs.pubsub.subscribe(this._room, this._handleMessageBound);
    logDebug(`Joined room: ${this._room}`);
    this._roomMonitor = new PeerMonitor(this._ipfs.pubsub, this._room);

    this._roomMonitor.on('join', this._handleNewPeer.bind(this));
    this._roomMonitor.on('leave', this._handleLeavePeer.bind(this));
    this._roomMonitor.on('error', logError);
  }

  async getId() {
    const { id } = await this._ipfs.id();
    return id;
  }

  countOpenStores() {
    return this._cache.itemCount;
  }

  getStore(address) {
    assert(
      OrbitDB.isValidAddress(address),
      'Cannot get store using invalid address',
    );
    const cachedStore = this._cache.get(address);
    return cachedStore && cachedStore.orbitStore;
  }

  async close() {
    logDebug('Closing...');
    await this._orbitNode.disconnect();
    await this._ipfs.pubsub.unsubscribe(this._room, this._handleMessageBound);
    this._roomMonitor.stop();
    this._cache.reset();
  }

  async pinHash({ ipfsHash }) {
    if (!isIPFS.multihash(ipfsHash)) {
      logError(new Error('IPFS hash is invalid'));
      return;
    }

    logDebug(`Pinning ipfs hash: ${ipfsHash}`);
    await this._ipfs.pin.add(ipfsHash);
    this.emit('pinnedHash', ipfsHash);
  }

  async _openOrbitStore(address) {
    assert(
      OrbitDB.isValidAddress(address),
      'Cannot get store using invalid address',
    );
    return this._orbitNode.open(address, {
      accessController: permissiveAccessController,
    });
  }

  async pinStore({ address }) {
    if (!OrbitDB.isValidAddress(address)) {
      logError(new Error(`Cannot pin store using invalid address: ${address}`));
      return;
    }

    const { _cache: cache } = this;
    let cachedStore = cache.get(address);
    if (!cachedStore) {
      const orbitStore = await this._openOrbitStore(address);
      cachedStore = new CachedStore(orbitStore, () => cache.del(address));
      /*
       @NOTE: If we try to add one more store to the cache, it'll drop the LRU
       store and close it upon eviction using the store disposal function. Thus
       limiting the number of open stores to process.env.OPEN_STORES_THRESHOLD
      */
      cache.set(address, cachedStore);
    } else {
      cachedStore.resetTTL();
      return;
    }

    logDebug(`Pinning orbit store: ${address}`);
    logDebug(`Open stores: ${this.countOpenStores()}`);
    cachedStore.orbitStore.events.on(
      'replicate.progress',
      (storeAddress, hash, entry, progress, have) => {
        cachedStore.resetTTL();
        assert(isIPFS.multihash(hash), 'Cannot pin invalid IPFS hash');
        this._ipfs.pin.add(hash).then(() => logDebug(`Pinned hash "${hash}"`));
        if (progress === have) {
          cachedStore.orbitStore.events.on('replicated', () => {
            logDebug(`Store "${address}" replicated`);
            this.emit('pinned', address);
          });
        }
      },
    );
  }

  async loadStore({ address }) {
    if (!OrbitDB.isValidAddress(address)) {
      logError(
        new Error(`Cannot load store using invalid address: ${address}`),
      );
      return;
    }

    const { _cache: cache } = this;
    let cachedStore = cache.get(address);
    if (!cachedStore) {
      const orbitStore = await this._openOrbitStore(address);
      cachedStore = new CachedStore(orbitStore, () => cache.del(address));
      /*
       @NOTE: If we try to add one more store to the cache, it'll drop the LRU
       store and close it upon eviction using the store disposal function. Thus
       limiting the number of open stores to process.env.OPEN_STORES_THRESHOLD
      */
      cache.set(address, cachedStore);
    } else {
      cachedStore.resetTTL();
      return;
    }

    logDebug(`Loading orbit store: ${address}`);
    logDebug(`Open stores: ${this.countOpenStores()}`);
    cachedStore.orbitStore.events.on('ready', () =>
      this._sendHeads(cachedStore.orbitStore),
    );
    cachedStore.orbitStore.events.on('replicated', () => {
      this.emit('loadedStore', address);
      cachedStore.resetTTL();
    });

    await cachedStore.orbitStore.load();
  }
}

module.exports = Pinner;
