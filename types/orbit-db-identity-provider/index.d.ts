declare module 'orbit-db-identity-provider' {
  interface Signatures {
    id: string; // The 'wallet signature' (the Ethereum account address, signed by Orbit's key)
    publicKey: string; // The opposite: the Orbit key's public key plus the previous signature (concatenated and signed)
  }

  interface IdentityObject {
    id: string; // IPFS ID
    publicKey: string; // Orbit public key
    signatures: Signatures;
    type: string; // Provider type
  }

  namespace IdentityProvider {
    export class Identity {
      private _id: string;
      private _provider: IdentityProvider<Identity>;
      private _publicKey: string;
      private _signatures: Signatures;
      private _type: string;
      readonly id: string;
      readonly provider: IdentityProvider<Identity>;
      public toJSON(): IdentityObject;
    }
  }

  class IdentityProvider<I = IdentityProvider.Identity> {
    private _type: string;
    readonly type: string;
    public createIdentity(): Promise<I>;
    public sign(identity: I, data: string | Buffer): Promise<string>;
    public verify(
      signature: string,
      publicKey: string,
      data: string | Buffer,
    ): Promise<boolean>;
  }

  export = IdentityProvider;
}
