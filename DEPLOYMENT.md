# Deployment

## Requirements

- Node (v10.x.x)
- IPFS node running (using go-ipfs) \*

* You will probably need a secure websocket reverse proxy (namely, a star server) if you're running on `js-ipfs` since it doesn't play well with `go-ipfs` yet. If you do, make sure `js-ipfs` and the websocket can talk to each other:

```json
"Swarm": [
  "/ip4/0.0.0.0/tcp/4001",
  "/ip6/::/tcp/4001",
  "/ip4/0.0.0.0/tcp/4003/ws", <<<<< Proxy listening to it
  "/ip6/::/tcp/4003/ws"       <<<<< Proxy listening to it
]
```

## Usage

Install pinion, set the environment variables for the IPFS node and then run it passing a pinning room as an argument, otherwise, it will use `COLONY_PINNING_ROOM`:

```bash
npm i -g @colony/pinion
# make sure env variables are defined ;)
pinion 'COLONY_PINNING_ROOM'
```

```bash
yarn add global @colony/pinion
# make sure env variables are defined ;)
pinion 'COLONY_PINNING_ROOM'
```

## Environment Variables

#### OPEN_STORES_THRESHOLD

You can also specify the limit of how many stores you wanna keep open simultaneously by passing in an environment variable `OPEN_STORES_THRESHOLD`. The limit is by default set to 1000 stores.

#### OPEN_STORE_TIMEOUT_MS

You can specify for how long pinion keeps a store open before it's closed. The limit is by default `300000` ms

#### DAEMON_URL

You can specify the an IPFS node url as you see fit. The default is `/ip4/127.0.0.1/tcp/5001`

#### ORBITDB_PATH

You can specify the orbit-db path option so stores data are kept in the place of your preference. The default is `./orbitdb`
