# Deployment

## Requirements

- IPFS node running (using go-ipfs)
- Secure websocket reverse proxy (to connect to our pinning service since `js-ipfs` can't swarm properly yet) \*

## Usage

Install pinion globally, set the environment variables for the IPFS node and then run it passing a pinning room as an argument, otherwise, it will use `COLONY_PINNING_ROOM`:

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

You can specify the an IPFS node url of your preference. The default is `/ip4/127.0.0.1/tcp/5001`

#### ORBITDB_PATH

You can specify the orbit-db path option so stores data are kept in the place of your preference. The default is `./orbitdb`

- Make sure IPFS node and wss can talk to each other:

```json
"Swarm": [
  "/ip4/0.0.0.0/tcp/4001",
  "/ip6/::/tcp/4001",
  "/ip4/0.0.0.0/tcp/4003/ws", <<<<<
  "/ip6/::/tcp/4003/ws"       <<<<<
]
```
