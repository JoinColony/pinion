/**
 * @file IPFSNode A little abstraction around IPFS to make debugging and error
 * handling easier. It also handles the pubsub subscriptions for us as well as
 * the room peer handling.
 */

import IPFS from 'ipfs';
import ipfsClient from 'ipfs-http-client';
import debug from 'debug';
import isIPFS from 'is-ipfs';
import PeerMonitor from 'ipfs-pubsub-peer-monitor';

import events from './events';

interface Message<T, P> {
  type: T;
  // Can be a store address or an ipfs peer id
  to: string;
  payload: P;
}

const log = debug('pinner:ipfs');
const logError = debug('pinner:ipfs:error');

class IPFSNode {
  private id: string = '';

  private readonly ipfs: IPFS;

  private readonly room: string;

  private roomMonitor!: PeerMonitor;

  constructor(ipfsDaemonURL: string, room: string) {
    this.ipfs = ipfsClient(ipfsDaemonURL);
    this.room = room;
  }

  private handlePubsubMessage = (msg: IPFS.PubsubMessage): void => {
    if (!(msg && msg.from && msg.data)) {
      logError(`Message is invalid: ${msg}`);
      return;
    }

    // Don't handle messages from ourselves
    if (msg.from === this.id) return;
    log(`New Message from: ${msg.from}`);
    log(msg.data.toString());
    events.emit('pubsub:message', msg);
  };

  private handleNewPeer = (peer: string): void => {
    log(`New peer: ${peer}`);
    events.emit('pubsub:newpeer', peer);
  };

  private handleLeavePeer = (peer: string): void => {
    log(`Peer left: ${peer}`);
    events.emit('pubsub:peerleft', peer);
  };

  public getIPFS(): IPFS {
    return this.ipfs;
  }

  public async getId(): Promise<string> {
    const { id } = await this.ipfs.id();
    return id;
  }

  public async init(): Promise<void> {
    this.id = await this.getId();
    await this.ipfs.pubsub.subscribe(this.room, this.handlePubsubMessage);
    log(`Joined room: ${this.room}`);

    this.roomMonitor = new PeerMonitor(this.ipfs.pubsub, this.room);
    this.roomMonitor.on('join', this.handleNewPeer);
    this.roomMonitor.on('leave', this.handleLeavePeer);
    this.roomMonitor.on('error', logError);
  }

  public async stop(): Promise<void> {
    this.roomMonitor.stop();
    return this.ipfs.pubsub.unsubscribe(this.room, this.handlePubsubMessage);
  }

  public publish<T, P>(message: Message<T, P>): Promise<void> {
    const msgString = JSON.stringify(message);
    log(`Publishing to room ${this.room}: ${msgString}`);
    return this.ipfs.pubsub.publish(this.room, Buffer.from(msgString));
  }

  public async pinHash(ipfsHash: string): Promise<void> {
    if (!isIPFS.cid(ipfsHash)) {
      logError(`IPFS hash is invalid: ${ipfsHash}`);
      return;
    }
    log(`Pinning ipfs hash: ${ipfsHash}`);
    try {
      await this.ipfs.pin.add(ipfsHash);
    } catch (caughtError) {
      logError(`Could not pin hash ${ipfsHash}: ${caughtError}`);
    }
  }
}

export default IPFSNode;
