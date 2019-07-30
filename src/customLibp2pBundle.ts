import Libp2p = require('libp2p');
import TCP = require('libp2p-tcp');
import MulticastDNS = require('libp2p-mdns');
import WebSocketStarMulti = require('libp2p-websocket-star-multi');
import KadDHT = require('libp2p-kad-dht');
import MPLEX = require('pull-mplex');
import SECIO = require('libp2p-secio');
import multiaddr = require('multiaddr');
import wrtc = require('wrtc');
import WStar = require('libp2p-webrtc-star');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const createConfig = ({ peerInfo, peerBook }) => {
  // Create our WebSocketStar transport and give it our PeerId, straight from the ipfs node
  const wsstarServers = peerInfo.multiaddrs
    .toArray()
    .map(String)
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    .filter(addr => addr.includes('p2p-websocket-star'));
  // the ws-star-multi module will replace this with the chosen ws-star servers
  peerInfo.multiaddrs.replace(
    wsstarServers.map(multiaddr),
    '/p2p-websocket-star',
  );
  const wsstar = new WebSocketStarMulti({
    servers: wsstarServers,
    id: peerInfo.id,
    // eslint-disable-next-line @typescript-eslint/camelcase
    ignore_no_online: true,
  });

  const wStar = new WStar({ wrtc });

  // Build and return our libp2p node
  return new Libp2p({
    peerInfo,
    peerBook,
    // Lets limit the connection managers peers and have it check peer health less frequently
    connectionManager: {
      minPeers: 25,
      maxPeers: 100,
      pollInterval: 5000,
    },
    modules: {
      transport: [TCP, wsstar, wStar],
      streamMuxer: [MPLEX],
      connEncryption: [SECIO],
      peerDiscovery: [MulticastDNS, wsstar.discovery, wStar.discovery],
      dht: KadDHT,
    },
    config: {
      peerDiscovery: {
        autoDial: true, // auto dial to peers we find when we have less peers than `connectionManager.minPeers`
        mdns: {
          interval: 10000,
          enabled: true,
        },
        bootstrap: {
          // We're purposefully disabling bootstrap
          interval: 30e3,
          enabled: false,
          list: [],
        },
      },
      // Turn on relay with hop active so we can connect to more peers
      relay: {
        enabled: true,
        hop: {
          enabled: true,
          active: true,
        },
      },
      dht: {
        enabled: false,
        kBucketSize: 20,
        randomWalk: {
          enabled: false,
          interval: 10e3, // This is set low intentionally, so more peers are discovered quickly. Higher intervals are recommended
          timeout: 2e3, // End the query quickly since we're running so frequently
        },
      },
      EXPERIMENTAL: {
        pubsub: true,
      },
    },
  });
};

export default createConfig;
