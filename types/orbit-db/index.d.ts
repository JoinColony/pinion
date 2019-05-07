declare module 'orbit-db' {
  import IPFS from 'ipfs';
  import AccessControllers from 'orbit-db-access-controllers';
  import OrbitDBStore from 'orbit-db-store';
  import OrbitDBKVStore from 'orbit-db-kvstore';

  interface OrbitOptions {
    AccessControllers?: AccessControllers;
    directory?: string;
  }

  interface StoreOpenOptions {
    accessController?: AccessControllers.AccessControllerObject;
    overwrite?: boolean;
  }

  class OrbitDB {
    public static createInstance(
      ipfs: IPFS,
      options?: OrbitOptions,
    ): Promise<OrbitDB>;
    public open<T extends OrbitDBStore = OrbitDBStore>(
      storeAddress: string,
      options?: StoreOpenOptions,
    ): Promise<T>;
    public disconnect(): Promise<void>;
    public kvstore(
      storeIdentifier: string,
      options?: StoreOpenOptions,
    ): Promise<OrbitDBKVStore>;
  }

  export = OrbitDB;
}
