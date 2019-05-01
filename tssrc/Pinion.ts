// FIXME move this to bin
const dotenv = require('dotenv');

if (process.env.NODE_ENV !== 'production') dotenv.config();

const assert = require('assert');
const EventEmitter = require('events');

const debug = require('debug');
const ipfsClient = require('ipfs-http-client');
const isIPFS = require('is-ipfs');
// const Cache = require('lru-cache');
const OrbitDB = require('orbit-db');
const PeerMonitor = require('ipfs-pubsub-peer-monitor');

// const CachedStore = require('./CachedStore');
// const AccessControllers = require('./AccessControllers');
// const PermissiveAccessController = require('./PermissiveAccessController');
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

type IPFSPubsubMessage = {
  from: string,
  seqno: Buffer,
  data: Buffer,
  topicIDs: string[],
};

type IPFSPubsubMessageHandler = (msg: IPFSPubsubMessage) => any;

type IPFSPeerIdentity = {
  id: string,
  publicKey: string,
};

type IPFSHashedObject = {
  hash: string,
};

// fixme do better
type IPFSClient = {
  id: () => Promise<IPFSPeerIdentity>,
  pin: {
    add: (hash: string, options?: { recursive: boolean }) => IPFSHashedObject[],
  },
  pubsub: {
    publish: (topic: string, data: Buffer) => Promise<void>,
    subscribe: (
      topic: string,
      handler: IPFSPubsubMessageHandler,
      options?: { discover: boolean }
    ) => Promise<void>,
    unsubscribe: (topic: string, handler: IPFSPubsubMessageHandler) => Promise<void>,
  };
};

type ClientActionType = typeof LOAD_STORE | typeof PIN_HASH | typeof PIN_STORE;

type ClientActionPayload = {
  ipfsHash?: string,
  address?: string,
};

type ClientAction = {
  type: typeof LOAD_STORE | typeof PIN_HASH | typeof PIN_STORE,
  payload: ClientActionPayload,
};

type Message<T, P> = {
  type: T,
  // Can be a store address or an ipfs peer id
  to: string,
  payload: P,
};

type ReplicationMessagePayload = {
  address: string,
  count: number,
  timestamp: number,
};

type AckMessagePayload = {
  acknowledgedAction: ClientActionType,
  sender: string,
  address?: string,
  ipfsHash?: string,
  timestamp: number,
}

type Options = {
  ipfsDaemonURL: string,
  maxOpenStores: number,
}

class Pinion extends EventEmitter {
  private readonly ipfs: IPFSClient;
  
  private readonly room: string;

  // FIXME no idea how this works in TS
  // roomMonitor: RoomMonitor;

  constructor(room: string, {
    ipfsDaemonURL = '/ip4/127.0.0.1/tcp/5001',
    maxOpenStores = 100,
  }: Options) {
    super();

    assert(room && room.length, 'Pinning room is required for pinion to start');

    this.ipfs = ipfsClient(ipfsDaemonURL);
    this.room = room;
  }

  // Bind handleMessage to this instance
  private handleMessage = async (message: IPFSPubsubMessage) => {
    if (!(message && message.from && message.data)) {
      logError(`Message is invalid: ${message}`);
      return;
    }

    // Don't handle messages from ourselves
    if (message.from === this.id) return;
    logPubsub(`New Message from: ${message.from}`);
    logPubsub(message.data.toString());
    let action: ClientAction | undefined;
    try {
      action = JSON.parse(message.data.toString());
    } catch (e) {
      logError(`Could not parse pinner message: ${message.data}`);
    }

    if (!action) return;
    const { type, payload } = action;
    const { ipfsHash, address } = payload;

    // Send ACK
    try {
      await this.publishAck(type, message.from, address, ipfsHash);
    } catch (caughtError) {
      logError(caughtError);
    } finally {
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
  };

  private handleNewPeer = (peer: string) => {
    logPubsub(`New peer: ${peer}`);
    this.emit('newpeer', peer);
  };

  private handleLeavePeer = (peer: string) => {
    logPubsub(`Peer left: ${peer}`);
    this.emit('peerleft', peer);
  };

  private publish<T, P>(message: Message<T, P>) {
    const msgString = JSON.stringify(message);
    logPubsub(`Publishing: ${msgString}`);
    return this.ipfs.pubsub.publish(this.room, Buffer.from(msgString));
  }

  private publishHeads(storeAddress: string, heads: number) {
    return this.publish<typeof HAVE_HEADS, ReplicationMessagePayload>({
      type: HAVE_HEADS,
      to: storeAddress,
      payload: {
        address: storeAddress,
        count: heads,
        timestamp: Date.now(),
      },
    });
  }

  private publishReplicated(storeAddress: string, heads: number) {
    return this.publish<typeof REPLICATED, ReplicationMessagePayload>({
      type: REPLICATED,
      to: storeAddress,
      payload: {
        address: storeAddress,
        count: heads,
        timestamp: Date.now(),
      },
    });
  }

  // fixme this function is still a bit chaotic. clean up!
  private publishAck(
    acknowledgedAction: ClientActionType,
    sender: string,
    storeAddress?: string,
    ipfsHash?: string,
  ) {
    return this.publish<typeof ACK, AckMessagePayload>({
      type: ACK,
      to: sender,
      payload: {
        acknowledgedAction,
        sender,
        address: storeAddress,
        ipfsHash,
        timestamp: Date.now(),
      },
    });
  }

  async init() {
    this.id = await this.getId();
    logDebug(`Pinner id: ${this.id}`);

    // fixme do this in the StoreCache
    // this._orbitNode = await OrbitDB.createInstance(this._ipfs, {
    //   AccessControllers,
    //   directory: process.env.ORBITDB_PATH || './orbitdb',
    // });

    await this.ipfs.pubsub.subscribe(this.room, this.handleMessage);
    logDebug(`Joined room: ${this.room}`);
    this.roomMonitor = new PeerMonitor(this.ipfs.pubsub, this.room);

    this.roomMonitor.on('join', this.handleNewPeer);
    this.roomMonitor.on('leave', this.handleLeavePeer);
    this.roomMonitor.on('error', logError);
  }

  async getId() {
    const { id } = await this.ipfs.id();
    return id;
  }

  async close() {
    logDebug('Closing...');
    // FIXME
    // await this._orbitNode.disconnect();
    await this.ipfs.pubsub.unsubscribe(this.room, this.handleMessage);
    this.roomMonitor.stop();
    // FIXME
    // this._cache.reset();
  }

  async pinHash({ ipfsHash }: ClientActionPayload) {
    if (!ipfsHash || !isIPFS.cid(ipfsHash)) {
      logError('IPFS hash is invalid');
      return;
    }

    logDebug(`Pinning ipfs hash: ${ipfsHash}`);
    try {
      await this.ipfs.pin.add(ipfsHash);
    } catch (caughtError) {
      logError(`Could not pin hash ${ipfsHash}: ${caughtError}`);
    }
    this.emit('pinnedHash', ipfsHash);
  }
}
