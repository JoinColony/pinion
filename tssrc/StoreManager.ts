/* This is the StoreManager. It's purpose is to keep track of open stores,
 * cache them and close them when adequate.
 * The cache will be a LRU cache and its values consist of objects that contain
 * a storePromise which will resolve in an open store and a timeStamp on when
 * the store was opened last. We choose this interface
 * as we don't want to open a store twice on high-frequent requests.
 * Furthermore we can close store in a more predictable way.
 */

const OrbitDB = require('orbit-db');
const debug = require('debug');
const LRU = require('lru-cache');

const logStores = debug('storeManager');

type StoreType =
  | 'counter'
  | 'eventlog'
  | 'feed'
  | 'docstore'
  | 'keyvalue';

// FIXME: I thought adding this would be easier. Let's get back to this. Maybe
// simplify types, we don't really care that much here.

interface OrbitDBStore {
  _oplog: {
    _length: number,
  };
  address: { root: string, path: string };
  key: any;
  type: StoreType;
  replicationStatus: {
    buffered: number,
    queued: number,
    progress: number,
    max: number,
  };

  events: typeof EventEmitter;

  constructor(
    ipfs: IPFS,
    identity: Identity,
    address: string,
    options: {},
  ): OrbitDBStore;

  load(): Promise<void>;
  load(amount: number): Promise<void>;

  close(): Promise<void>;
  drop(): Promise<void>;

  _addOperation(data: any): void;
}

type StoreManagerOptions = {
  maxOpenStores: number,
  storeTTL: number
};

type CachedStore = {
  storePromise: Promise<OrbitDBStore>,
  lastOpenedAt: number,
};

class StoreManager {
  private cache: typeof LRU;

  constructor({
    maxOpenStores = 1000,
    storeTTL = 60 * 1000,
  }: StoreManagerOptions) {
    
    this.cache = new LRU({
      max: maxOpenStores || 1000,
      dispose: this.closeStore,
    });
  }

  private closeStore = (address: string, store: CachedStore) => {
    // FIXME: implement me
  }
}
