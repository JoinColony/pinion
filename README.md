<!--<div align="center">-->
<!--  <img src="/docs/img/pinion_color.svg" width="600" />-->
<!--</div>-->
<!--<div align="center">-->
<!--  <a href="https://circleci.com/gh/JoinColony/pinion">-->
<!--    <img src="https://circleci.com/gh/JoinColony/pinion.svg?style=shield" />-->
<!--  </a>-->
<!--  <a href="https://greenkeeper.io/">-->
<!--    <img src="https://badges.greenkeeper.io/JoinColony/pinion.svg" />-->
<!--  </a>-->
<!--  <a href="https://gitter.im/JoinColony/pinion">-->
<!--    <img src="https://img.shields.io/gitter/room/TechnologyAdvice/Stardust.svg" />-->
<!--  </a>-->
<!--  <a href="https://build.colony.io/">-->
<!--    <img src="https://img.shields.io/discourse/https/build.colony.io/status.svg" />-->
<!--  </a>-->
<!--</div>-->

# Pinion 📌

Pinion is a lightweight pinning service that supports both IPFS content and [orbit-db](https://github.com/orbitdb/orbit-db) stores. It relies solely on [ipfs-pubsub-peer-monitor](https://github.com/ipfs-shipyard/ipfs-pubsub-peer-monitor), [orbit-db](https://github.com/orbitdb/orbit-db), and [js-ipfs-http-client](https://github.com/ipfs/js-ipfs-http-client) to communicate with an IPFS node.

Pinion can:

- **Pin IPFS content**
- **Pin orbit-db store content**
- **Keep listening to updates from any given orbit-db store**

## Installation

To install pinion, run:

```bash
yarn add global @colony/pinion
```

or

```bash
npm i -g @colony/pinion
```

And then run pinion passing a IPFS node endpoint and a pinning room:

```bash
DAEMON_URL='/ip4/127.0.0.1/tcp/5001' pinion 'COLONY_PINNING_ROOM'
```

### Custom configuration

#### OPEN_STORES_THRESHOLD

You can also specify the limit of how many stores you wanna keep open simultaneously by passing in an environment variable `OPEN_STORES_THRESHOLD`. The limit is by default set to 1000 stores.

#### OPEN_STORE_TIMEOUT_MS

You can specify for how long pinion keeps a store open before it's closed. The limit is by default `300000` ms

#### DAEMON_URL

You can specify the an IPFS node url of your preference. The default is `/ip4/127.0.0.1/tcp/5001`

#### ORBITDB_PATH

You can specify the orbit-db path option so stores data are kept in the place of your preference. The default is `./orbitdb`

### Debug

Pinion is still on its infancy and you might need debug info or a more detailed output to figure out if it misbehaves. To run it on verbose/debug mode, please also set an environment var like so `DEBUG='pinner:*'`.

## API

### Requests

#### PIN_STORE

Opens a store, keeps listening to it for a pre-defined timeout and pin its content until the time is up or it's replicated.

##### Parameters

1.  `OrbitDBAddress` - An orbit-db-store address. Emits a `pinned` event passing the store address back.

##### Payload example

```js
 {
   type: 'PIN_STORE',
   payload: { address: '/orbitdb/Qma=/my-store/<signature>' },
 };
```

---

#### LOAD_STORE

Opens a store, loads it and keep listening to it for a pre-defined timeout.

##### Parameters

1.  `OrbitDBAddress` - An orbit-db-store address. Emits a `loadedStore` event passing the store address back.

##### Payload example

```js
 {
   type: 'LOAD_STORE',
   payload: { address: '/orbitdb/Qma=/my-store/<signature>' },
 };
```

---

#### PIN_HASH

Request the IPFS node to pin the content hash.

##### Parameters

1.  `ipfsHash` - An IPFS multihash. Emits a `pinnedHash` event passing the ipfs hash back.

##### Payload example

```js
 {
   type: 'PIN_HASH',
   payload: { ipfsHash: 'Qma=...' },
 };
```

---

#### Responses

##### HAVE_HEADS

Published when the pinner has opened a store and it's ready

##### Payload example

```js
 {
   type: 'HAVE_HEADS',
   to: '/orbitdb/Qma=/my-store/<signature>',
   payload: {
     address: '/orbitdb/Qma=/my-store/<signature>',
     count: 100,
     timestamp: 10010203993
  },
 }
```

---

##### ACK

Published on every incoming message, acknowledging we got it with either the `ipfsHash` or the orbit-db store address

##### Payload example

```js
 {
   type: 'ACK',
   to: 'Qma=',
   payload: {
     sender: 'Qma=',
     actionType: 'PIN_STORE',
     address: '/orbitdb/Qma=/my-store/<signature>',
     ipfsHash: 'Qma=...',
     timestamp: 10010203993
   },
 }
```

---

##### REPLICATED

Published after a store is fully replicated

##### Payload example

```js
 {
   type: 'REPLICATED',
   to: '/orbitdb/Qma=/my-store/<signature>',
   payload: {
     address: '/orbitdb/Qma=/my-store/<signature>',
     count: 100,
     timestamp: 10010203993
   },
 }
```

---

## Contributing

We welcome all contributions to Pinion. You can help by testing, suggesting new features, improving performance or documentation.

Please read our [Contributing Guidelines](https://github.com/JoinColony/pinion/blob/master/.github/CONTRIBUTING.md) for how to get started.

## License

Pinion is [MIT licensed](LICENSE)
