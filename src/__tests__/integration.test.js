const { promisify } = require('util');

const test = require('ava');
const Pubsub = require('orbit-db-pubsub');
const OrbitDB = require('orbit-db');
const { create: createIPFS } = require('ipfsd-ctl');

const Pinner = require('..');
const { LOAD_STORE, PIN_STORE } = require('../actions');

let portCounter = 0;

const getIPFSNode = async pinnerId => {
  portCounter += 1;
  const client = createIPFS({ type: 'js' });
  const ipfsd = await promisify(client.spawn.bind(client))({
    config: {
      Addresses: {
        Swarm: [
          `/ip4/0.0.0.0/tcp/${4003 + portCounter}`,
          `/ip6/::/tcp/${4003 + portCounter}`,
        ],
      },
      // Bootstrap with our pinner node
      Bootstrap: [`/ip4/127.0.0.1/tcp/4001/ipfs/${pinnerId}`],
    },
    start: false,
  });
  await promisify(ipfsd.start.bind(ipfsd))(['--enable-pubsub-experiment']);
  const { id: ipfsdId } = await ipfsd.api.id();
  return {
    ipfs: ipfsd.api,
    id: ipfsdId,
  };
};

const getOrbitNode = async ipfs =>
  OrbitDB.createInstance(ipfs, {
    directory: `./orbitdb-test-data/test-${Math.round(Math.random() * 100000)}`,
  });

const createKVStore = async (orbitNode, data = {}) => {
  const store = await orbitNode.kvstore('kvstore1');
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await store.set(keys[i], data[keys[i]]);
  }
  return store;
};

test('pinner joins the defined pubsub room', async t => {
  const room = 'JOIN_ROOM';
  const pinner = await Pinner.createInstance({ room });
  const { id: pinnerId } = await pinner._ipfs.id();
  const { ipfs, id: ipfsdId } = await getIPFSNode(pinnerId);
  const pubsub = new Pubsub(ipfs, ipfsdId);
  return new Promise(async resolve => {
    await pubsub.subscribe(
      room,
      () => {},
      async (topic, peer) => {
        t.is(peer, pinnerId);
        await pinner.close();
        resolve();
      },
    );
  });
});

test('pinner pins stuff', async t => {
  const room = 'PIN_ROOM';
  const pinner = await Pinner.createInstance({ room });
  const { id: pinnerId } = await pinner._ipfs.id();
  const { ipfs, id: ipfsdId } = await getIPFSNode(pinnerId);
  const pubsub = new Pubsub(ipfs, ipfsdId);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, { foo: 'bar', biz: 'baz' });
  await pubsub.subscribe(
    room,
    () => {},
    () => {
      // On every new peer we tell everyone that we want to pin the store
      pubsub.publish(room, {
        type: PIN_STORE,
        payload: { address: store.address.toString() },
      });
    },
  );
  const pinnedStoreAddress = await new Promise(resolve => {
    pinner.on('pinned', msg => {
      resolve(msg);
    });
  });
  t.is(pinnedStoreAddress, store.address.toString());
});

test('A third peer can request a previously pinned store', async t => {
  const room = 'LOAD_ROOM';
  const pinner = await Pinner.createInstance({ room });
  const { id: pinnerId } = await pinner._ipfs.id();
  const { ipfs, id: ipfsdId } = await getIPFSNode(pinnerId);
  const pubsub = new Pubsub(ipfs, ipfsdId);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, { foo: 'bar', biz: 'baz' });
  // Subscribe to the pinning room
  await pubsub.subscribe(
    room,
    () => {},
    () => {
      // On every new peer we tell everyone that we want to pin the store
      pubsub.publish(room, {
        type: PIN_STORE,
        payload: { address: store.address.toString() },
      });
      pubsub.disconnect();
    },
  );
  // Wait for pinner to be done
  await new Promise(resolve => pinner.on('pinned', resolve));
  // Close the first store (no replication possible)
  await store.close();
  const { ipfs: ipfs2, id: ipfsdId2 } = await getIPFSNode(pinnerId);
  const pubsub2 = new Pubsub(ipfs2, ipfsdId2);
  const orbit2 = await getOrbitNode(ipfs2);
  await pubsub2.subscribe(
    room,
    () => {},
    () => {
      // On every new peer we tell everyone that we want to load the store
      pubsub2.publish(room, {
        type: LOAD_STORE,
        payload: { address: store.address.toString() },
      });
    },
  );
  const store2 = await orbit2.open(store.address.toString());
  await new Promise(resolve =>
    store2.events.on(
      'replicate.progress',
      (storeAddress, hash, entry, progress, have) => {
        if (progress === have) {
          const interval = setInterval(() => {
            // Related to https://github.com/orbitdb/orbit-db/issues/509
            // We have to do some weird checks in order to know when we're actually ready
            if (
              store2.replicationStatus.progress === store2.replicationStatus.max
            ) {
              clearInterval(interval);
              resolve();
            }
          }, 1000);
        }
      },
    ),
  );
  const data = store2.get('foo');
  t.deepEqual(data, 'bar');
});
