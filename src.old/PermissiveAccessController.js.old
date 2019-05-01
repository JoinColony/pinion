/* eslint-disable class-methods-use-this, no-empty-function */
class PermissiveAccessController {
  static get type() {
    return 'PERMISSIVE';
  }

  get type() {
    return this.constructor.type;
  }

  async load() {}

  async grant() {
    return true;
  }

  async revoke() {
    return true;
  }

  async save() {
    return this.constructor.type;
  }

  async canAppend() {
    return true;
  }
}
/* eslint-enable class-methods-use-this, no-empty-function */

module.exports = PermissiveAccessController;
