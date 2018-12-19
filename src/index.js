const dotenv = require('dotenv');

if (process.env.NODE_ENV !== 'production') dotenv.config();

const EventEmitter = require('events');
const { Buffer } = require('buffer');

const debug = require('debug');
const ipfsClient = require('ipfs-http-client');
const Cache = require('lru-cache');
const OrbitDB = require('orbit-db');
const PeerMonitor = require('ipfs-pubsub-peer-monitor');

const { HAVE_HEADS, LOAD_STORE, PIN_HASH, PIN_STORE } = require('./actions');

const logError = debug('pinner:error');
const logDebug = debug('pinner:debug');
const logPubsub = debug('pinner:pubsub');

const storeCacheDisposal = (address, store) =>
  store.close().then(() => {
    logDebug(`Store "${address}" was closed...`);
  });

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
      max: Number(OPEN_STORES_THRESHOLD),
      dispose: storeCacheDisposal,
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

  async close() {
    logDebug('Closing...');
    await this._orbitNode.disconnect();
    await this._ipfs.pubsub.unsubscribe(this._room, this._handleMessageBound);
    this._roomMonitor.stop();
  }

  async pinHash({ ipfsHash }) {
    logDebug(`Pinning ipfs hash: ${ipfsHash}`);
    await this._ipfs.pin.add(ipfsHash);
    this.emit('pinnedHash', ipfsHash);
  }

  async pinStore({ address }) {
    logDebug(`Pinning orbit store: ${address}`);
    const store = await this._orbitNode.open(address, {
      accessController: permissiveAccessController,
    });
    // TODO: race for replicated or timeout
    store.events.on(
      'replicate.progress',
      (storeAddress, hash, entry, progress, have) => {
        this._ipfs.pin.add(hash);
        // TODO: pin on infura:
        // https://infura.io/docs/ipfs/get/pin_add
        // https://ipfs.infura.io:5001/api/v0/pin/add?arg=<ipfs-path>&recursive=true&progress=<value>
        if (progress === have) {
          store.events.on('replicated', () => {
            this.emit('pinned', address);
          });
          // TODO: keep it open for some time
          // store.close();
        }
      },
    );
  }

  async loadStore({ address }) {
    logDebug(`Loading orbit store: ${address}`);
    const store = await this._orbitNode.open(address, {
      accessController: permissiveAccessController,
    });
    store.events.on('ready', () => this._sendHeads(store));
    await store.load();
    // TODO: race for replicated (shorter timeout) or long timeout
  }
}

module.exports = Pinner;
