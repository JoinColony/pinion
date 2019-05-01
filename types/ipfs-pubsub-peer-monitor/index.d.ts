declare module 'ipfs-pubsub-peer-monitor' {
  import EventEmitter from 'events';
  import IPFS from 'ipfs';

  interface Options {
    start?: boolean;
    pollInterval?: number;
  }

  class IpfsPubsubPeerMonitor extends EventEmitter {
    constructor(pubsub: IPFS.Pubsub, topic: string, options?: Options);
    public start(): void;
    public stop(): void;
    public getPeers(): Promise<string[]>;
    public hasPeer(): boolean;
  }

  export = IpfsPubsubPeerMonitor;
}
