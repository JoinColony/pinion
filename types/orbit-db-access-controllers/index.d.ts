declare module 'orbit-db-access-controllers' {
  import OrbitDB from 'orbit-db';

  class AccessControllerFactory {
    public static create(
      orbitDB: OrbitDB,
      type: string,
      accessControllerObject: AccessControllerFactory.AccessControllerObject,
    ): string;

    public static resolve(
      orbitDB: OrbitDB,
      type: string,
      accessControllerObject: AccessControllerFactory.AccessControllerObject,
    ): AccessControllerFactory.AccessController;
  }

  namespace AccessControllerFactory {
    class AccessController {
      public static readonly type: string;
      public readonly type: string;
      public load(): Promise<void>;
      public grant(): Promise<boolean>;
      public revoke(): Promise<boolean>;
      public save(): Promise<string>;
      public canAppend(): Promise<boolean>;
    }

    interface AccessControllerObject {
      controller: AccessController;
    }
  }

  export = AccessControllerFactory;
}
