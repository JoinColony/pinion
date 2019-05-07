declare module 'orbit-db-store' {
  import EventEmitter from 'events';
  import IPFS from 'ipfs';
  import { Identity } from 'orbit-db-identity-provider';
  import { EntryData } from 'ipfs-log';
  import { AccessController } from 'orbit-db-access-controllers';

  abstract class OrbitDBStore {
    constructor(
      ipfs: IPFS,
      identity: Identity,
      address: string,
      options: {
        // There are more options but we don't really care for now. This isn't how
        // you create a store anyways
        accessController: AccessController;
      },
    );

    private _oplog: { _length: number };
    private _addOperation(data: EntryData): void;

    public readonly address: OrbitDBStore.StoreAddress;
    // https://github.com/orbitdb/orbit-db-store/blob/master/src/Store.js#L138
    public readonly key: string;
    public events: EventEmitter;
    public type: OrbitDBStore.StoreType;
    public replicationStatus: {
      buffered: number;
      queued: number;
      progress: number;
      max: number;
    };
    public load(): Promise<void>;
    public load(amount: number): Promise<void>;

    public close(): Promise<void>;
    public drop(): Promise<void>;
  }

  namespace OrbitDBStore {
    export type StoreType =
      | 'counter'
      | 'eventlog'
      | 'feed'
      | 'docstore'
      | 'keyvalue';

    export interface StoreAddress {
      root: string;
      path: string;
      toString: () => string;
    }
  }

  export = OrbitDBStore;
}
