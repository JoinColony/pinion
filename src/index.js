const EventEmitter = require('events');

const ipfsClient = require('ipfs-http-client');
const OrbitDB = require('orbit-db');
const Pubsub = require('orbit-db-pubsub');

const { HAVE_HEADS, LOAD_STORE, PIN_STORE } = require('./actions');

const ORBITDB_PATH = './orbitdb';
const DAEMON_URL = '/ip4/127.0.0.1/tcp/5001';
const PINNING_ROOM = 'COLONY_PINNING_ROOM';

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
  constructor(ipfs, orbitNode, pubsub, room) {
    super();
    this._ipfs = ipfs;
    this._orbitNode = orbitNode;
    this._pubsub = pubsub;
    this._room = room;
  }

  static async createInstance({ room = PINNING_ROOM } = {}) {
    const ipfs = ipfsClient(DAEMON_URL);
    const { id } = await ipfs.id();
    console.info(`Pinner id: ${id}`);
    const orbitNode = await OrbitDB.createInstance(ipfs, {
      directory: ORBITDB_PATH,
    });
    const pubsub = new Pubsub(ipfs, id);
    const pinner = new Pinner(ipfs, orbitNode, pubsub, room);
    await pubsub.subscribe(
      room,
      pinner.handleNewMessage.bind(pinner),
      pinner.handleNewPeer.bind(pinner),
    );
    return pinner;
  }

  _sendHeads(store) {
    this._pubsub.publish(this._room, {
      type: HAVE_HEADS,
      to: store.address,
      // eslint-disable-next-line no-underscore-dangle
      payload: { address: store.address, count: store._oplog._length },
    });
  }

  async close() {
    await this._orbitNode.disconnect();
    await this._pubsub.disconnect();
  }

  handleNewPeer(topic, peer) {
    this.emit('newpeer', { topic, peer });
  }

  async pinStore({ address }) {
    console.info(`opening store: ${address}`);
    const store = await this._orbitNode.open(address, {
      accessController: permissiveAccessController,
    });
    // TODO: race for replicated or timeout
    store.events.on(
      'replicate.progress',
      (storeAddress, hash, entry, progress, have) => {
        this._ipfs.pin.add(hash);
        if (progress === have) {
          this.emit('pinned', address);
          // TODO: keep it open for some time
          store.close();
          // TODO: db.events.on('closed', (dbname) => ... )
        }
      },
    );
  }

  async loadStore({ address }) {
    console.info(`opening store: ${address}`);
    const store = await this._orbitNode.open(address, {
      accessController: permissiveAccessController,
    });
    store.events.on('ready', () => this._sendHeads(store));
    await store.load();
    // TODO: race for replicated (shorter timeout) or long timeout
  }

  handleNewMessage(topic, { type, payload }) {
    console.info(`Got new message on ${topic}`);
    console.info(type);
    switch (type) {
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
}

module.exports = Pinner;
