/**
 * @file StoreManager It's purpose is to keep track of open stores, cache them
 * and close them when adequate. The cache is a LRU cache and its values
 * consist of objects that contain a storePromise which will resolve in an open
 * store and a timeStamp on when the store was opened last. We choose this
 * interface as we don't want to open a store twice on high-frequent requests.
 * Furthermore we can close store in a more predictable way.
 */

import OrbitDBStore from 'orbit-db-store';
import { Entry } from 'ipfs-log';

import debug = require('debug');
import LRU = require('lru-cache');
import OrbitDB = require('orbit-db');

import events from './events';
import AccessControllers from './AccessControllers';
import PermissiveAccessController from './PermissiveAccessController';
import IPFSNode from './IPFSNode';

const log = debug('pinner:storeManager');

type StoreType = 'counter' | 'eventlog' | 'feed' | 'docstore' | 'keyvalue';

interface StoreManagerOptions {
  maxOpenStores: number;
  orbitDBDir: string;
  storeTTL: number;
}

interface CachedStore {
  storePromise: Promise<OrbitDBStore>;
  lastOpenedAt: number;
}

class StoreManager {
  private readonly cache: LRU<string, CachedStore>;

  private readonly ipfsNode: IPFSNode;

  private readonly options: { orbitDBDir: string };

  private orbitNode!: OrbitDB;

  constructor(
    ipfsNode: IPFSNode,
    { maxOpenStores, orbitDBDir, storeTTL }: StoreManagerOptions,
  ) {
    this.ipfsNode = ipfsNode;
    this.cache = new LRU({
      max: maxOpenStores,
      dispose: this.closeStore,
    });
    this.options = { orbitDBDir };
  }

  private closeStore = (address: string, store: CachedStore) => {
    // @fixme: implement me
  };

  private async openStore(address: string): Promise<CachedStore> {
    log(`Opening store: ${address}`);
    const store = this.cache.get(address);
    if (store) {
      log(`Store already open: ${address}`);
      // @fixme: I'm under the assumption here that the cache doesn't copy the values.
      // Please double check.
      store.lastOpenedAt = Date.now();
      return store;
    }
    log(`Opening store from orbit: ${address}`);
    // @todo: Will this throw when the store does not exist?
    const storePromise = this.orbitNode.open(address, {
      accessController: {
        /* @todo: we are using the permissive access controller for now, eventually we want to use our access controllers */
        controller: new PermissiveAccessController(),
      },
      overwrite: false,
    });
    const cachedStore = { storePromise, lastOpenedAt: Date.now() };
    this.cache.set(address, cachedStore);
    return cachedStore;
  }

  public async init(): Promise<void> {
    // @fixme: run cleanup function interval every 2 minutes?
    const ipfs = this.ipfsNode.getIPFS();
    this.orbitNode = await OrbitDB.createInstance(ipfs, {
      AccessControllers,
      directory: this.options.orbitDBDir,
    });
  }

  public async stop(): Promise<void> {
    await this.orbitNode.disconnect();
    this.cache.reset();
  }

  public async pinStore(address: string): Promise<void> {
    const cachedStore = await this.openStore(address);
    const store = await cachedStore.storePromise;
    const pinHeadHash = (storeAddress: string, ipfsHash: string): void => {
      cachedStore.lastOpenedAt = Date.now();
      this.ipfsNode.pinHash(ipfsHash);
    };
    const handlePeerExchanged = (
      peer: string,
      storeAddress: string,
      heads: Entry[],
    ): void => {
      log(`Store "${address}" replicated for ${peer}`);
      events.emit('stores:pinned', address, heads);
      store.events.off('replicate.progress', pinHeadHash);
      store.events.off('peer.exchanged', handlePeerExchanged);
    };
    store.events.on('replicate.progress', pinHeadHash);
    store.events.on('peer.exchanged', handlePeerExchanged);
  }

  public async loadStore(address: string) {
    const store = await this.openStore(address);
    // @fixme: add more load logic?
  }
}

export default StoreManager;
