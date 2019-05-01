/* eslint-disable @typescript-eslint/interface-name-prefix */

declare module 'ipfs' {
  import { Readable } from 'stream';

  // TODO: add pull-stream once it's typed: https://github.com/pull-stream/pull-stream/issues/57
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

  // TODO: add CID: https://github.com/multiformats/js-cid/blob/master/src/index.js.flow
  type IPFSPath = string | Buffer;

  interface AddOptions {
    pin: boolean;
    recursive: boolean;
    // TODO: add them all
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

  interface IPFS {
    id(): Promise<PeerIdentity>;
    add(
      data: IPFSData | IPFSDataInputObject[],
      options: AddOptions,
    ): Promise<IPFSDataOutputObject[]>;
    cat(
      path: IPFSPath,
      options?: {
        offset?: number;
        length?: number;
      },
    ): Promise<Buffer>;
    pin: Pin;
    pubsub: IPFS.Pubsub;
  }

  namespace IPFS {
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
