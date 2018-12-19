const { Buffer } = require('buffer');
const { promisify } = require('util');

const test = require('ava');
const PeerMonitor = require('ipfs-pubsub-peer-monitor');
const OrbitDB = require('orbit-db');
const { create: createIPFS } = require('ipfsd-ctl');

const Pinner = require('..');
const { LOAD_STORE, PIN_HASH, PIN_STORE } = require('../actions');

const noop = () => {};

let portCounter = 0;

const getIPFSNode = async pinnerId => {
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
  const pinner = new Pinner(room);
  const pinnerId = await pinner.getId();
  const { ipfs } = await getIPFSNode(pinnerId);

  await ipfs.pubsub.subscribe(room, noop);
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);

  const promises = [
    new Promise(resolve => roomMonitor.on('join', resolve)),
    pinner.init(),
  ];

  const [peer] = await Promise.all(promises);

  t.is(peer, pinnerId);
  await ipfs.pubsub.unsubscribe(room, noop);
  return pinner.close();
});

test('pinner pins stuff', async t => {
  const room = 'PIN_ROOM';
  const pinner = new Pinner(room);
  const pinnerId = await pinner.getId();
  const { ipfs } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, { foo: 'bar', biz: 'baz' });
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', () => {
    const action = {
      type: PIN_STORE,
      payload: { address: store.address.toString() },
    };
    ipfs.pubsub.publish(room, Buffer.from(JSON.stringify(action)));
  });
  await pinner.init();
  const pinnedStoreAddress = await new Promise(resolve => {
    pinner.on('pinned', msg => {
      resolve(msg);
    });
  });
  t.is(pinnedStoreAddress, store.address.toString());
  await ipfs.pubsub.unsubscribe(room, noop);
  await orbit.disconnect();
  roomMonitor.stop();
  return pinner.close();
});

test('pinner can pin hashes', async t => {
  const room = 'PIN_ROOM';
  const pinner = new Pinner(room);
  const pinnerId = await pinner.getId();
  const { ipfs } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const [{ hash: ipfsHash }] = await ipfs.add(Buffer.from('test'));
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  roomMonitor.on('join', () => {
    const action = {
      type: PIN_HASH,
      payload: { ipfsHash },
    };
    ipfs.pubsub.publish(room, Buffer.from(JSON.stringify(action)));
  });
  await pinner.init();
  const publishedIpfsHash = await new Promise(resolve => {
    pinner.on('pinnedHash', msg => {
      resolve(msg);
    });
  });
  t.is(publishedIpfsHash, ipfsHash);
  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  return pinner.close();
});

test('A third peer can request a previously pinned store', async t => {
  const room = 'LOAD_ROOM';
  const pinner = new Pinner(room);
  const pinnerId = await pinner.getId();
  const { ipfs } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const orbit = await getOrbitNode(ipfs);
  const store = await createKVStore(orbit, { foo: 'bar', biz: 'baz' });
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);

  // On every new peer we tell everyone that we want to pin the store
  roomMonitor.on('join', () => {
    const action = {
      type: PIN_STORE,
      payload: { address: store.address.toString() },
    };
    ipfs.pubsub.publish(room, Buffer.from(JSON.stringify(action)));
  });

  await pinner.init();
  // Wait for pinner to be done
  await new Promise(resolve => pinner.on('pinned', resolve));

  // Close the first store (no replication possible)
  await store.close();

  const { ipfs: ipfs2 } = await getIPFSNode(pinnerId);
  await ipfs2.pubsub.subscribe(room, noop);
  const roomMonitor2 = new PeerMonitor(ipfs2.pubsub, room);
  const orbit2 = await getOrbitNode(ipfs2);

  // On every new peer we tell everyone that we want to load the store
  roomMonitor2.on('join', () => {
    const action = {
      type: LOAD_STORE,
      payload: { address: store.address.toString() },
    };
    ipfs2.pubsub.publish(room, Buffer.from(JSON.stringify(action)));
  });

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
  t.is(data, 'bar');

  await ipfs2.pubsub.unsubscribe(room, noop);
  roomMonitor2.stop();
  await orbit2.disconnect();
  return pinner.close();
});
