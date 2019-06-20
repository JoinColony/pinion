/* eslint-disable @typescript-eslint/interface-name-prefix */

declare module 'ipfs' {
  import { Readable } from 'stream';
  import { EventEmitter } from 'events';

  // @todo: add pull-stream once it's typed: https://github.com/pull-stream/pull-stream/issues/57
  type IPFSData = Buffer | Readable;

  interface IPFSDataInputObject {
    path: string;
    content: IPFSData;
  }

  interface IPFSDataOutputObject {
    path: string;
    hash: string;
    size: number;
  }

  // @todo: add CID: https://github.com/multiformats/js-cid/blob/master/src/index.js.flow
  type IPFSPath = string | Buffer;

  interface AddOptions {
    pin: boolean;
    recursive: boolean;
    // @todo: add them all
  }

  interface PeerIdentity {
    id: string;
    publicKey: string;
  }

  interface HashedObject {
    hash: string;
  }

  interface Pin {
    add: (hash: string, options?: { recursive: boolean }) => HashedObject[];
  }

  interface InitOptions {
    emptyRepo?: boolean;
    bits?: number;
    privateKey?: string | IPFS.PeerId;
  }

  interface IPFSConfig {
    Addresses?: {
      Swarm: string[];
      API: string;
      Gateway: string;
    };
    Discovery?: {
      MDNS: {
        Enabled: boolean;
        Interval: number;
      };
      webRTCStar: {
        Enabled: boolean;
      };
    };
    Bootstrap?: string[];
    Swarm?: {
      ConnMgr: {
        LowWater: number;
        HighWater: number;
      };
    };
    Identity?: {
      PeerID: string;
      PrivKey: string;
    };
  }

  interface IPFSOptions {
    repo?: string | IPFS.Repo;
    init?: boolean | InitOptions;
    start?: boolean;
    pass?: string;
    silent?: boolean;
    relay?: {
      enabled?: boolean;
      hop?: { enabled?: boolean; active?: boolean };
    };
    preload?: { enabled?: boolean; addresses?: string[] };
    EXPERIMENTAL?: { pubsub?: boolean; sharding?: boolean; dht?: boolean };
    config?: IPFSConfig;
    // @todo type ipld interface
    ipld?: {};
    // @todo type libp2p interface
    libp2p?: {};
    // @todo type connectionManager interface
    connectionManager?: {};
  }

  class IPFS extends EventEmitter {
    constructor(options: IPFSOptions);
    public id(): Promise<PeerIdentity>;
    public add(
      data: IPFSData | IPFSDataInputObject[],
      options: AddOptions,
    ): Promise<IPFSDataOutputObject[]>;
    public cat(
      path: IPFSPath,
      options?: {
        offset?: number;
        length?: number;
      },
    ): Promise<Buffer>;
    public isOnline(): boolean;
    public start(): Promise<void>;
    public stop(): Promise<void>;
    public pin: Pin;
    public pubsub: IPFS.Pubsub;
  }

  namespace IPFS {
    // @todo type Repo interface
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    export interface Repo {}
    // @todo: type PeerID interface
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface PeerId {}
    export interface PubsubMessage {
      from: string;
      seqno: Buffer;
      data: Buffer;
      topicIDs: string[];
    }
    export type PubsubMessageHandler = (msg: IPFS.PubsubMessage) => void;
    export interface Pubsub {
      publish: (topic: string, data: Buffer) => Promise<void>;
      subscribe: (
        topic: string,
        handler: PubsubMessageHandler,
        options?: { discover: boolean },
      ) => Promise<void>;
      unsubscribe: (
        topic: string,
        handler: PubsubMessageHandler,
      ) => Promise<void>;
    }
  }

  export = IPFS;
}
