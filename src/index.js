const EventEmitter = require('events');

const ipfsClient = require('ipfs-http-client');
const OrbitDB = require('orbit-db');
const Pubsub = require('orbit-db-pubsub');

const { PIN_STORE } = require('./actions');

const ORBITDB_PATH = './orbitdb';
const DAEMON_URL = '/ip4/127.0.0.1/tcp/5001';
const PINNING_ROOM = 'xxx';

class Pinner extends EventEmitter {
  constructor(ipfs, orbitNode, pubsub) {
    super();
    this._ipfs = ipfs;
    this._orbitNode = orbitNode;
    this._pubsub = pubsub;
  }

  static async createInstance({ room = PINNING_ROOM } = {}) {
    const ipfs = ipfsClient(DAEMON_URL);
    const { id } = await ipfs.id();
    const orbitNode = await OrbitDB.createInstance(ipfs, {
      directory: ORBITDB_PATH,
    });
    const pubsub = new Pubsub(ipfs, id);
    const pinner = new Pinner(ipfs, orbitNode, pubsub);
    await pubsub.subscribe(
      room,
      pinner.handleNewMessage.bind(pinner),
      pinner.handleNewPeer.bind(pinner),
    );
    return pinner;
  }

  handleNewPeer(topic, peer) {
    this.emit('newpeer', { topic, peer });
  }

  async pinStore({ address }) {
    // TODO: Probably try/catch
    console.info(`opening store: ${address}`);
    const store = await this._orbitNode.open(address);
    store.events.on(
      'replicate.progress',
      (storeAddress, hash, entry, progress, have) => {
        console.info(`storeAddress: ${storeAddress}`);
        console.info(`hash: ${hash}`);
        console.info(`entry: ${entry}`);
        console.info(`progress: ${progress}`);
        console.info(`have: ${have}`);
        this._ipfs.pin.add(hash);
        if (progress === have) this.emit('pinned', address);
      },
    );
  }

  handleNewMessage(topic, { type, payload }) {
    console.info(`Got new message on ${topic}`);
    console.info(type);
    switch (type) {
      case PIN_STORE: {
        this.pinStore(payload);
        break;
      }
      default:
        break;
    }
  }
}

module.exports = Pinner;
