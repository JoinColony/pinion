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
    return this.orbitNode.open(address, {
      accessController: {
        /* @todo: we are using the permissive access controller for now, eventually we want to use our access controllers */
        controller: new PermissiveAccessController(),
      },
      overwrite: false,
    });
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

  public async loadStore(address: string): Promise<OrbitDBStore | void> {
    return this.cache.load(address);
  }

  public async closeStore(address: string): Promise<OrbitDBStore | void> {
    return this.cache.remove(address);
  }

  public async pinStore(address: string): Promise<void> {
    const store = await this.loadStore(address);
    if (!store) {
      return log(new Error(`Could not open store to pin: ${address}`));
    }
    const pinHeadHash = (storeAddress: string, ipfsHash: string): void => {
      this.ipfsNode.pinHash(ipfsHash);
    };
    const handlePeerExchanged = (
      peer: string,
      storeAddress: string,
      heads: Entry[],
    ): void => {
      log(`Store "${address}" replicated for ${peer}`);
      this.events.emit('stores:pinned', address, heads);
      store.events.off('replicate.progress', pinHeadHash);
      store.events.off('peer.exchanged', handlePeerExchanged);
    };
    store.events.on('replicate.progress', pinHeadHash);
    store.events.on('peer.exchanged', handlePeerExchanged);
  }
}

export default StoreManager;