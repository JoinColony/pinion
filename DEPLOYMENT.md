# Deployment

## Requirements

- Node (v10.x.x)
- IPFS node running (using go-ipfs) \*

* You will probably need a secure websocket reverse proxy if you're running on `js-ipfs` since it doesn't play well with `go-ipfs` yet. If you're using a websocket reverse proxy, make sure IPFS node and wss can talk to each other:

```json
"Swarm": [
  "/ip4/0.0.0.0/tcp/4001",
  "/ip6/::/tcp/4001",
  "/ip4/0.0.0.0/tcp/4003/ws", <<<<< Proxy listening to it
  "/ip6/::/tcp/4003/ws"       <<<<< Proxy listening to it
]
```

## Usage

**Create a new config for your IPFS node, DO NOT USE THE ONES PROVIDED in `data-go` or `data-ipfs`, otherwise the identity of your node will be compromised!**

For installation and usage see the [Readme](README.md).
