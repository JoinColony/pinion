declare module 'orbit-db-kvstore' {
  import OrbitDBStore from 'orbit-db-store';
  import { EntryData } from 'ipfs-log';

  class OrbitDBKVStore extends OrbitDBStore {
    public put(key: string, value: EntryData): Promise<void>;
    public set(key: string, value: EntryData): Promise<void>;
    public all(): Record<string, EntryData>;
    public get(key: string): EntryData;
  }

  export = OrbitDBKVStore;
}
