import { randomBytes } from 'crypto';
import { promisify } from 'util';
import IPFS from 'ipfs';
import { serial as test } from 'ava';
import { EntryData } from 'ipfs-log';

import PeerMonitor = require('ipfs-pubsub-peer-monitor');
import OrbitDB = require('orbit-db');
import OrbitDBKVStore from 'orbit-db-kvstore';
// @ts-ignore We don't want to type that right now
import { create as createIPFS } from 'ipfsd-ctl';

import Pinion, { ClientAction } from '../Pinion';
import { ClientActions, PinnerActions } from '../actions';
const { LOAD_STORE, PIN_STORE, PIN_HASH } = ClientActions;
const { ACK, HAVE_HEADS, REPLICATED } = PinnerActions;
import AccessControllers from '../AccessControllers';
import PermissiveAccessController from '../PermissiveAccessController';

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

test('pinner joins the defined pubsub room', async t => {
  const room = 'JOIN_ROOM';
  const pinner = new Pinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // We're initializing it to make ts happy
  let resolveRoomMonitor = noop;
  const roomMonitorPromise = new Promise(
    (resolve): void => {
      resolveRoomMonitor = resolve;
    },
  );
  roomMonitor.on('join', resolveRoomMonitor);
  await pinner.init();
  const peer = await roomMonitorPromise;
  t.is(peer, pinnerId);
  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('pinner pins stuff', async t => {
  const room = 'PIN_ROOM';
  const pinner = new Pinion(room);
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
  roomMonitor.on(
    'join',
    (): void => {
      const action: ClientAction = {
        type: PIN_STORE,
        payload: { address: store.address.toString() },
      };
      publishMessage(ipfs, room, action);
    },
  );
  await pinner.init();
  const pinnedStoreData = await new Promise(resolve => {
    pinner.events.on('stores:pinned', async (address, heads) => {
      // @Note this uses internal APIs so this may break any minute
      // BUT it's the only way to test whether all the data was pinned
      const nextHead = await ipfs.dag.get(heads[0].next);
      const result = [heads[0].payload, nextHead.value.payload].reduce(
        (data, current) => {
          data[current.key] = current.value;
          return data;
        },
        {},
      );
      resolve(result);
    });
  });
  t.deepEqual(pinnedStoreData, storeData);
  await ipfs.pubsub.unsubscribe(room, noop);
  await orbit.disconnect();
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('pinner responds upon replication event', async t => {
  const room = 'REPLICATED_PIN_ROOM';
  const pinner = new Pinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, 'replicated.kvstore1', {
    foo: 'bar',
    biz: 'baz',
  });
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', () => {
    const action = {
      type: PIN_STORE,
      payload: { address: store.address.toString() },
    };
    publishMessage(ipfs, room, action);
  });
  await pinner.init();
  const gotReplicated = await new Promise(resolve => {
    ipfs.pubsub.subscribe(room, (msg: IPFS.PubsubMessage) => {
      const {
        type,
        payload: { address },
      } = JSON.parse(msg.data.toString());
      if (type === REPLICATED && address === store.address.toString())
        resolve(true);
    });
  });
  t.truthy(gotReplicated);
  await ipfs.pubsub.unsubscribe(room, noop);
  await orbit.disconnect();
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('pinner ACK actions', async t => {
  const room = 'ACK_ROOM';
  const pinner = new Pinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, 'ack.kvstore1', {
    foo: 'bar',
    biz: 'baz',
  });
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', () => {
    const action = {
      type: PIN_STORE,
      payload: { address: store.address.toString() },
    };
    publishMessage(ipfs, room, action);
  });
  await pinner.init();
  const gotAck = await new Promise(resolve => {
    ipfs.pubsub.subscribe(room, (msg: IPFS.PubsubMessage) => {
      const {
        type,
        payload: { acknowledgedAction, address },
      } = JSON.parse(msg.data.toString());
      if (
        type === ACK &&
        acknowledgedAction === PIN_STORE &&
        address === store.address.toString()
      )
        resolve(true);
    });
  });
  t.truthy(gotAck);
  await ipfs.pubsub.unsubscribe(room, noop);
  await orbit.disconnect();
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});

test('pinner can pin hashes', async t => {
  console.log('color');
  const room = 'PIN_HASH_ROOM';
  const pinner = new Pinion(room);
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
  await pinner.init();
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
  const pinner = new Pinion(room);
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
      type: PIN_STORE,
      payload: { address: store.address.toString() },
    };
    publishMessage(ipfs, room, action);
  });

  await pinner.init();
  // Wait for pinner to be done
  await new Promise(resolve => pinner.events.on('stores:pinned', resolve));

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
      type: LOAD_STORE,
      payload: { address: store.address.toString() },
    };
    ipfs2.pubsub
      .publish(room, Buffer.from(JSON.stringify(action)))
      .catch((caughtError: Error) => console.error(caughtError));
  });

  await new Promise(resolve => store2.events.on('peer.exchanged', resolve));

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

test.only('pinner caches stores and limit them to a pre-defined threshold', async t => {
  const room = 'CACHED_PIN_ROOM';
  const pinner = new Pinion(room, { maxOpenStores: 1 });
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
      type: PIN_STORE,
      payload: { address: store1.address.toString() },
    };
    const secondAction = {
      type: PIN_STORE,
      payload: { address: store2.address.toString() },
    };
    publishMessage(ipfs, room, firstAction);
    publishMessage(ipfs, room, secondAction);
  });
  await pinner.init();
  await new Promise(resolve => {
    pinner.events.on('stores:pinned', msg => {
      resolve(msg);
    });
  });
  t.is(pinner.openStores, 1);
  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  await orbit.disconnect();
  await store1.close();
  await store2.close();
  await teardown();
  return pinner.close();
});
