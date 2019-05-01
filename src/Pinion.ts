/**
 * @file Pinion The main class. It is responsible for the vast amount of communication
 * with the client and starting up the other instances.
 */

import assert from 'assert';

import IPFS from 'ipfs';
import debug from 'debug';

import {
  ACK,
  HAVE_HEADS,
  LOAD_STORE,
  PIN_HASH,
  PIN_STORE,
  REPLICATED,
} from './actions';

import events from './events';
import StoreManager from './StoreManager';
import IPFSNode from './IPFSNode';

const logError = debug('pinner:error');
const logDebug = debug('pinner:debug');

type ClientActionType = 'LOAD_STORE' | 'PIN_HASH' | 'PIN_STORE';

interface ClientActionPayload {
  ipfsHash?: string;
  address?: string;
}

export interface ClientAction {
  type: typeof LOAD_STORE | typeof PIN_HASH | typeof PIN_STORE;
  payload: ClientActionPayload;
}

interface ReplicationMessagePayload {
  address: string;
  count: number;
  timestamp: number;
}

interface AckMessagePayload {
  acknowledgedAction: ClientActionType;
  sender: string;
  address?: string;
  ipfsHash?: string;
  timestamp: number;
}

interface Options {
  ipfsDaemonURL?: string;
  maxOpenStores?: number;
  storeTTL?: number;
  orbitDBDir?: string;
}

class Pinion {
  private id: string = '';

  private readonly ipfsNode: IPFSNode;

  private readonly storeManager: StoreManager;

  constructor(
    room: string,
    {
      ipfsDaemonURL = '/ip4/127.0.0.1/tcp/5001',
      maxOpenStores = 100,
      storeTTL = 60 * 1000,
      orbitDBDir = './orbitdb',
    }: Options = {},
  ) {
    assert(room && room.length, 'Pinning room is required for pinion to start');

    this.ipfsNode = new IPFSNode(ipfsDaemonURL, room);

    this.storeManager = new StoreManager(this.ipfsNode, {
      maxOpenStores,
      storeTTL,
      orbitDBDir,
    });

    events.on('pubsub:message', this.handleMessage);
    events.on('stores:pinned', this.publishReplicated);
  }

  private handleMessage = async (
    message: IPFS.PubsubMessage,
  ): Promise<void> => {
    let action: ClientAction | undefined;
    try {
      action = JSON.parse(message.data.toString());
    } catch (e) {
      logError(`Could not parse pinner message: ${message.data}`);
    }

    if (!action) return;
    const { type, payload } = action;
    const { ipfsHash, address } = payload;

    // Send ACK
    try {
      await this.publishAck(type, message.from, address, ipfsHash);
    } catch (caughtError) {
      logError(caughtError);
    } finally {
      switch (type) {
        case PIN_HASH: {
          if (!ipfsHash) {
            logError('PIN_HASH: no ipfsHash given');
            return;
          }
          this.ipfsNode.pinHash(ipfsHash).catch(logError);
          break;
        }
        case PIN_STORE: {
          if (!address) {
            logError('PIN_STORE: no address given');
            return;
          }
          this.storeManager.pinStore(address).catch(logError);
          break;
        }
        case LOAD_STORE: {
          if (!address) {
            logError('LOAD_STORE: no address given');
            return;
          }
          this.storeManager.loadStore(address);
          break;
        }
        default:
          break;
      }
    }
  };

  private publishReplicated = (
    storeAddress: string,
    heads: number,
  ): Promise<void> => {
    return this.ipfsNode.publish<'REPLICATED', ReplicationMessagePayload>({
      type: REPLICATED,
      to: storeAddress,
      payload: {
        address: storeAddress,
        count: heads,
        timestamp: Date.now(),
      },
    });
  };

  private publishHeads(storeAddress: string, heads: number): Promise<void> {
    return this.ipfsNode.publish<'HAVE_HEADS', ReplicationMessagePayload>({
      type: HAVE_HEADS,
      to: storeAddress,
      payload: {
        address: storeAddress,
        count: heads,
        timestamp: Date.now(),
      },
    });
  }

  // @fixme this function is still a bit chaotic. clean up!
  private publishAck(
    acknowledgedAction: ClientActionType,
    sender: string,
    storeAddress?: string,
    ipfsHash?: string,
  ): Promise<void> {
    return this.ipfsNode.publish<'ACK', AckMessagePayload>({
      type: ACK,
      to: sender,
      payload: {
        acknowledgedAction,
        sender,
        address: storeAddress,
        ipfsHash,
        timestamp: Date.now(),
      },
    });
  }

  public async init(): Promise<void> {
    logDebug(`Pinner id: ${this.id}`);
    await this.ipfsNode.init();
    await this.storeManager.init();
  }

  public async getId(): Promise<string> {
    return this.ipfsNode.getId();
  }

  public async close(): Promise<void> {
    logDebug('Closing...');
    await this.ipfsNode.stop();
    await this.storeManager.stop();
    events.removeAllListeners();
  }
}

export default Pinion;
