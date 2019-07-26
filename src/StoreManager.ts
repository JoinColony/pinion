/**
 * @file StoreManager It's purpose is to keep track of open stores, cache them
 * and close them when adequate. The cache is a LRU cache and its values
 * consist of objects that contain a storePromise which will resolve in an open
 * store and a timeStamp on when the store was opened last. We choose this
 * interface as we don't want to open a store twice on high-frequent requests.
 * Furthermore we can close store in a more predictable way.
 */

import OrbitDBStore from 'orbit-db-store';

import debug = require('debug');
import OrbitDB = require('orbit-db');
import EventEmitter = require('events');

import AccessControllers from './AccessControllers';
import PermissiveAccessController from './PermissiveAccessController';
import IPFSNode from './IPFSNode';
import AsyncLRU from './AsyncLRU';

const log = debug('pinner:storeManager');

type StoreType = 'counter' | 'eventlog' | 'feed' | 'docstore' | 'keyvalue';

interface StoreManagerOptions {
  maxOpenStores: number;
  orbitDBDir: string;
}

class StoreManager {
  private readonly cache: AsyncLRU<string, OrbitDBStore>;

  private readonly events: EventEmitter;

  private readonly ipfsNode: IPFSNode;

  private readonly options: { orbitDBDir: string };

  private orbitNode!: OrbitDB;

  constructor(
    events: EventEmitter,
    ipfsNode: IPFSNode,
    { maxOpenStores, orbitDBDir }: StoreManagerOptions,
  ) {
    this.events = events;
    this.ipfsNode = ipfsNode;
    this.cache = new AsyncLRU({
      max: maxOpenStores,
      load: this.load,
      remove: this.remove,
    });
    this.options = { orbitDBDir };
  }

  public get openStores(): number {
    return this.cache.length;
  }

  private remove = async (
    address: string,
    store: OrbitDBStore | void,
  ): Promise<void> => {
    if (!store) {
      return log(new Error(`Could not close store: ${address}`));
    }
    return store.close();
  };

  private load = async (address: string): Promise<OrbitDBStore> => {
    log(`Opening store with address ${address}`);
    log(`Open stores: ${this.openStores}`);
    // I think this is done anyways by orbit, but just in case
    const pinHeadHash = (storeAddress: string, ipfsHash: string): void => {
      this.ipfsNode.pinHash(ipfsHash);
    };
    const store = await this.orbitNode.open(address, {
      accessController: {
        /* @todo: we are using the permissive access controller for now, eventually we want to use our access controllers */
        controller: new PermissiveAccessController(),
      },
      overwrite: false,
    });
    store.events.on('replicate.progress', pinHeadHash);
    return store;
  };

  public async start(): Promise<void> {
    const ipfs = this.ipfsNode.getIPFS();
    this.orbitNode = await OrbitDB.createInstance(ipfs, {
      AccessControllers,
      directory: this.options.orbitDBDir,
    });
  }

  public async stop(): Promise<void> {
    await this.cache.reset();
    return this.orbitNode.disconnect();
  }

  public async loadStore(address: string): Promise<number> {
    const store = await this.cache.load(address);
    if (store) {
      // This is a private API but there's no other way to access this atm
      // eslint-disable-next-line dot-notation
      return store['_oplog'].length;
    }
    return 0;
  }

  public async closeStore(address: string): Promise<OrbitDBStore | void> {
    return this.cache.remove(address);
  }
}

export default StoreManager;
