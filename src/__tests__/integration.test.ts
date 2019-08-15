import { randomBytes } from 'crypto';
import { promisify } from 'util';
import IPFS from 'ipfs';
// Running mulitple IPFS instances is confusing the tests (event though it
// should not). So we run them serially
import { serial as test } from 'ava';
import { EntryData } from 'ipfs-log';

import PeerMonitor = require('ipfs-pubsub-peer-monitor');
import OrbitDB = require('orbit-db');
import OrbitDBKVStore from 'orbit-db-kvstore';
import { create as createIPFS } from 'ipfsd-ctl';

import Pinion, { ClientAction } from '../Pinion';
import { ClientActions, PinnerActions } from '../actions';
import AccessControllers from '../AccessControllers';
import PermissiveAccessController from '../PermissiveAccessController';

const { REPLICATE, PIN_HASH } = ClientActions;
const { HAVE_HEADS, ANNOUNCE_PINNER } = PinnerActions;

const { TEST_NODE_URL = '/ip4/127.0.0.1/tcp/4001/ipfs' } = process.env;

const noop = () => {};
const getId = () => randomBytes(16).toString('hex');
const publishMessage = async (
  ipfs: IPFS,
  room: string,
  action: ClientAction,
) => {
  ipfs.pubsub
    .publish(room, Buffer.from(JSON.stringify(action)))
    .catch(e => console.error(e));
};

let portCounter = 0;
let pinnerCounter = 0;

const getPinion = async (
  room: string,
  extraOpts?: { maxOpenStores: number },
): Promise<Pinion> => {
  const pinion = new Pinion(room, {
    ipfsRepo: `./ipfs-test-data/test-pinner-${pinnerCounter++}`,
    ...extraOpts,
  });
  await pinion['ipfsNode'].ready();
  return pinion;
};

const getIPFSNode = async (pinnerId: string) => {
  portCounter += 1;
  const client = createIPFS({ type: 'js' });
  const ipfsd = await promisify(client.spawn.bind(client))({
    config: {
      Addresses: {
        Swarm: [
          `/ip4/0.0.0.0/tcp/${4004 + portCounter}`,
          `/ip6/::/tcp/${4004 + portCounter}`,
        ],
      },
      // Bootstrap with our pinner node
      Bootstrap: [`${TEST_NODE_URL}/${pinnerId}`],
    },
    start: false,
  });
  await promisify(ipfsd.init.bind(ipfsd))({
    directory: `./ipfs-test-data/test-${getId()}`,
  });
  await promisify(ipfsd.start.bind(ipfsd))(['--enable-pubsub-experiment']);
  const { id: ipfsdId } = await ipfsd.api.id();
  const teardown = async () => {
    await promisify(ipfsd.cleanup.bind(ipfsd))();
    // TODO: if necessary we will add .stop here as well()
    return promisify(ipfsd.killProcess.bind(ipfsd))(4 * 1000);
  };
  return {
    ipfs: ipfsd.api,
    id: ipfsdId,
    teardown,
  };
};

const getOrbitNode = async (ipfs: IPFS) =>
  OrbitDB.createInstance(ipfs, {
    directory: `./orbitdb-test-data/test-${getId()}`,
    AccessControllers,
  });

const createKVStore = async (
  orbitNode: OrbitDB,
  storeIdentifier: string,
  data: Record<string, EntryData> = {},
) => {
  const store = await orbitNode.kvstore(storeIdentifier, {
    // @Note the access controller doesn't really matter, because of a bug in
    // orbit we still have to use the same one, as we share the OrbitDB module
    // in the tests
    accessController: { controller: new PermissiveAccessController() },
  });
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await store.set(keys[i], data[keys[i]]);
  }
  return store;
};

// Wait for replication until we have a certain amount of heads in a store
const waitForHeads = (
  ipfs: IPFS,
  storeAddress: string,
  room: string,
  heads: number,
): Promise<number> =>
  new Promise((resolve, reject) => {
    const action: ClientAction = {
      type: REPLICATE,
      payload: { address: storeAddress },
    };
    const interval = setInterval(
      () => publishMessage(ipfs, room, action),
      2000,
    );
    const timeout = setTimeout(
      () => reject(new Error('Replication timeout')),
      30000,
    );
    const handleMessage = (msg: IPFS.PubsubMessage) => {
      let action;
      try {
        action = JSON.parse(msg.data.toString());
      } catch (caughtError) {
        throw new Error(
          `Could not parse message data: ${caughtError.toString()}`,
        );
      }
      const {
        type,
        payload: { address, count },
      } = action;
      if (type === HAVE_HEADS && address === storeAddress && count >= heads) {
        ipfs.pubsub.unsubscribe(room, handleMessage).catch(reject);
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(count);
      }
    };
    ipfs.pubsub.subscribe(room, handleMessage).catch(reject);
  });

test('pinner joins the defined pubsub room', async t => {
  const room = 'JOIN_ROOM';
  const pinner = await getPinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // We're initializing it to make ts happy
  let resolveRoomMonitor = noop;
  const roomMonitorPromise = new Promise((resolve): void => {
    resolveRoomMonitor = resolve;
  });
  roomMonitor.on('join', resolveRoomMonitor);
  await pinner.start();
  const peer = await roomMonitorPromise;
  t.is(peer, pinnerId);
  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('pinner responds upon replication event', async t => {
  const room = 'REPLICATED_PIN_ROOM';
  const pinner = await getPinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, 'replicated.kvstore1', {
    foo: 'bar',
    biz: 'baz',
  });
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  const haveHeadsPromise = new Promise(resolve => {
    ipfs.pubsub.subscribe(room, (msg: IPFS.PubsubMessage) => {
      const {
        type,
        payload: { address, count },
      } = JSON.parse(msg.data.toString());
      if (type === HAVE_HEADS && address === store.address.toString())
        resolve(count);
    });
  });
  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', () => {
    const action = {
      type: REPLICATE,
      payload: { address: store.address.toString() },
    };
    publishMessage(ipfs, room, action);
  });
  await pinner.start();
  const heads = await haveHeadsPromise;
  t.is(heads, 0);
  await ipfs.pubsub.unsubscribe(room, noop);
  await orbit.disconnect();
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('pinner pins stuff', async t => {
  const room = 'PIN_ROOM';
  const pinner = await getPinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const storeData = {
    foo: 'bar',
    biz: 'baz',
  };
  const store = await createKVStore(orbit, 'kvstore1', storeData);
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', (): void => {
    const action: ClientAction = {
      type: REPLICATE,
      payload: { address: store.address.toString() },
    };
    publishMessage(ipfs, room, action);
  });
  await pinner.start();
  const heads = await waitForHeads(ipfs, store.address.toString(), room, 2);
  t.is(heads, 2);
  await ipfs.pubsub.unsubscribe(room, noop);
  await orbit.disconnect();
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('pinner can pin hashes', async t => {
  const room = 'PIN_HASH_ROOM';
  const pinner = await getPinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const [{ hash: ipfsHash }] = await ipfs.add(Buffer.from('test'));
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  roomMonitor.on('join', () => {
    const action = {
      type: PIN_HASH,
      payload: { ipfsHash },
    };
    publishMessage(ipfs, room, action);
  });
  await pinner.start();
  const publishedIpfsHash = await new Promise(resolve => {
    pinner.events.on('ipfs:pinned', (hash: string) => {
      resolve(hash);
    });
  });
  t.is(publishedIpfsHash, ipfsHash);
  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('A third peer can request a previously pinned store', async t => {
  const room = 'LOAD_ROOM';
  const pinner = await getPinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, 'load.kvstore1', {
    foo: 'bar',
    biz: 'baz',
  });
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);

  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', () => {
    const action = {
      type: REPLICATE,
      payload: { address: store.address.toString() },
    };
    publishMessage(ipfs, room, action);
  });

  await pinner.start();
  // Wait for pinner to be done
  await waitForHeads(ipfs, store.address.toString(), room, 2);

  // Close the first store (no replication possible)
  await store.close();
  roomMonitor.stop();

  const { ipfs: ipfs2, teardown: teardown2 } = await getIPFSNode(pinnerId);
  await ipfs2.pubsub.subscribe(room, noop);

  const orbit2 = await getOrbitNode(ipfs2);
  const store2 = await orbit2.open<OrbitDBKVStore>(store.address.toString(), {
    accessController: { controller: new PermissiveAccessController() },
  });

  const roomMonitor2 = new PeerMonitor(ipfs2.pubsub, room);

  // On every new peer we tell everyone that we want to load the store
  roomMonitor2.on('join', () => {
    const action = {
      type: REPLICATE,
      payload: { address: store.address.toString() },
    };
    ipfs2.pubsub
      .publish(room, Buffer.from(JSON.stringify(action)))
      .catch((caughtError: Error) => console.error(caughtError));
  });

  // Wait local store to be replicated
  await new Promise(resolve => {
    const interval = setInterval(() => {
      if (store2['_oplog'].length >= 2) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });

  const data = store2.get('foo');
  t.is(data, 'bar');

  await ipfs2.pubsub.unsubscribe(room, noop);
  roomMonitor2.stop();
  await orbit.disconnect();
  await orbit2.disconnect();
  await teardown();
  await teardown2();
  return pinner.close();
});

test('pinner caches stores and limit them to a pre-defined threshold', async t => {
  const room = 'CACHED_PIN_ROOM';
  const pinner = await getPinion(room, { maxOpenStores: 1 });
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const store1 = await createKVStore(orbit, 'cached.kvstore1', {
    foo: 'bar',
    biz: 'baz',
  });
  const store2 = await createKVStore(orbit, 'cached.kvstore2', {
    foo: 'bar',
    biz: 'baz',
  });

  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', () => {
    const firstAction = {
      type: REPLICATE,
      payload: { address: store1.address.toString() },
    };
    const secondAction = {
      type: REPLICATE,
      payload: { address: store2.address.toString() },
    };
    publishMessage(ipfs, room, firstAction);
    publishMessage(ipfs, room, secondAction);
  });
  await pinner.start();

  await waitForHeads(ipfs, store1.address.toString(), room, 2);
  await waitForHeads(ipfs, store2.address.toString(), room, 2);

  t.is(pinner.openStores, 1);
  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  await orbit.disconnect();
  await store1.close();
  await store2.close();
  await teardown();
  return pinner.close();
});

test('pinner announces its presence to peers', async t => {
  const room = 'PINNER_ANNOUNCEMENT_ROOM';
  const pinner = await getPinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);

  const pinnerAnnouncePromise: Promise<{
    type: string;
    payload: { ipfsId: string };
  }> = new Promise(resolve => {
    ipfs.pubsub.subscribe(room, (msg: IPFS.PubsubMessage) => {
      const action = JSON.parse(msg.data.toString());
      if (action.type === ANNOUNCE_PINNER) resolve(action);
    });
  });

  await pinner.start();

  // The pinner should have announced itself on start
  const pinnerAnnounceAction = await pinnerAnnouncePromise;
  t.is(pinnerAnnounceAction.payload.ipfsId, pinnerId);

  const newPeerResponsePromise: Promise<{
    type: string;
    payload: { ipfsId: string };
  }> = new Promise(resolve => {
    ipfs.pubsub.subscribe(room, (msg: IPFS.PubsubMessage) => {
      const action = JSON.parse(msg.data.toString());
      if (action.type === ANNOUNCE_PINNER) resolve(action);
    });
  });

  pinner.events.emit('pubsub:newpeer', 'client id');

  // The pinner should announce itself in response to a new peer joining
  const newPeerResponse = await newPeerResponsePromise;
  t.is(newPeerResponse.payload.ipfsId, pinnerId);

  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});
