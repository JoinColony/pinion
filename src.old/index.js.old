const dotenv = require('dotenv');

if (process.env.NODE_ENV !== 'production') dotenv.config();

const assert = require('assert');
const EventEmitter = require('events');
const { Buffer } = require('buffer');

const debug = require('debug');
const ipfsClient = require('ipfs-http-client');
const isIPFS = require('is-ipfs');
const Cache = require('lru-cache');
const OrbitDB = require('orbit-db');
const PeerMonitor = require('ipfs-pubsub-peer-monitor');

const CachedStore = require('./CachedStore');
const AccessControllers = require('./AccessControllers');
const PermissiveAccessController = require('./PermissiveAccessController');
const {
  ACK,
  HAVE_HEADS,
  LOAD_STORE,
  PIN_HASH,
  PIN_STORE,
  REPLICATED,
} = require('./actions');

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

class Pinner extends EventEmitter {
  constructor(room) {
    super();

    assert(room && room.length, 'Pinning room is required');

    const { DAEMON_URL, OPEN_STORES_THRESHOLD } = process.env;
    this._ipfs = ipfsClient(DAEMON_URL || '/ip4/127.0.0.1/tcp/5001');
    this._room = room;
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
      to: store.address.toString(),
      payload: {
        address: store.address.toString(),
        // eslint-disable-next-line no-underscore-dangle
        count: store._oplog._length,
        timestamp: Date.now(),
      },
    });
  }

  _announceReplicatedStore(store) {
    this._publish({
      type: REPLICATED,
      to: store.address.toString(),
      payload: {
        address: store.address.toString(),
        // @todo this can be the result of peer.exchanged
        // eslint-disable-next-line no-underscore-dangle
        count: store._oplog._length,
        timestamp: Date.now(),
      },
    });
  }

  _sendACK(actionType, sender, storeAddress, ipfsHash) {
    this._publish({
      type: ACK,
      to: sender,
      payload: {
        actionType,
        sender,
        address: storeAddress,
        ipfsHash,
        timestamp: Date.now(),
      },
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
      logError(`Message is invalid: ${message}`);
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
      logError(`Could not parse pinner message: ${message.data}`);
    }

    if (!action) return;
    const { type, payload } = action;
    const { hash, address } = payload;
    // Send ACK
    this._sendACK(type, message.from, address, hash);

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
      AccessControllers,
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
    if (!OrbitDB.isValidAddress(address))
      return logError('Cannot get store using invalid address');

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
    if (!isIPFS.cid(ipfsHash)) {
      logError('IPFS hash is invalid');
      return;
    }

    logDebug(`Pinning ipfs hash: ${ipfsHash}`);
    try {
      await this._ipfs.pin.add(ipfsHash);
    } catch (caughtError) {
      logError(`Could not pin hash ${ipfsHash}: ${caughtError}`);
    }
    this.emit('pinnedHash', ipfsHash);
  }

  async _openOrbitStore(address) {
    if (!OrbitDB.isValidAddress(address))
      return logError('Cannot open store using invalid address');

    return this._orbitNode.open(address, {
      accessController: {
        /* TODO: we are using the permissive access controller for now, eventually we want to use our access controllers */
        controller: new PermissiveAccessController(),
      },
      overwrite: false,
    });
  }

  async pinStore({ address }) {
    if (!OrbitDB.isValidAddress(address)) {
      logError(`Cannot pin store using invalid address: ${address}`);
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
    const pinHeadHash = (storeAddress, ipfsHash) => {
      cachedStore.resetTTL();
      this.pinHash({ ipfsHash });
    };
    const handlePeerExchanged = (peer, _, heads) => {
      logDebug(`Store "${address}" replicated for ${peer}`);
      // This is mostly done for testing, but could be used when pinion is part
      // of a larger system at some point
      this.emit('pinned', address, heads);
      this._announceReplicatedStore(cachedStore.orbitStore);
      cachedStore.orbitStore.events.off('replicate.progress', pinHeadHash);
      cachedStore.orbitStore.events.off('peer.exchanged', handlePeerExchanged);
    };
    cachedStore.orbitStore.events.on('replicate.progress', pinHeadHash);
    cachedStore.orbitStore.events.on('peer.exchanged', handlePeerExchanged);
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
