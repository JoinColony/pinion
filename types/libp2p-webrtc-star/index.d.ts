interface Options {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrtc: any;
}

declare module 'libp2p-webrtc-star' {
  class WStar {
    constructor(options: Options);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    discovery: any;
  }

  export = WStar;
}
