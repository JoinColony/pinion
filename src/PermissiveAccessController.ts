import AccessControllers from 'orbit-db-access-controllers';

class PermissiveAccessController implements AccessControllers.AccessController {
  public static get type(): string {
    return 'PERMISSIVE';
  }

  public get type(): string {
    return PermissiveAccessController.type;
  }

  public async load(): Promise<void> {}

  public async grant(): Promise<boolean> {
    return true;
  }

  public async revoke(): Promise<boolean> {
    return true;
  }

  public async save(): Promise<string> {
    return PermissiveAccessController.type;
  }

  public async canAppend(): Promise<boolean> {
    return true;
  }
}

export default PermissiveAccessController;
