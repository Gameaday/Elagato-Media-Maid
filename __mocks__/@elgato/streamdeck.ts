/**
 * Minimal mock of the @elgato/streamdeck module for Jest tests.
 * Only the parts consumed by MediaMaid actions need to be mocked.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export enum KeyAction {
  DOWN = "keyDown",
  UP = "keyUp"
}

export class SingletonAction<TSettings = Record<string, unknown>> {
  protected actions: any[] = [];

  async onKeyDown(_ev: any): Promise<void> { /* noop */ }
  async onKeyUp(_ev: any): Promise<void> { /* noop */ }
  async onWillAppear(_ev: any): Promise<void> { /* noop */ }
  async onDidReceiveSettings(_ev: any): Promise<void> { /* noop */ }
}

export function action(_opts: { UUID: string }) {
  return function <T extends new (...args: any[]) => any>(constructor: T): T {
    return constructor;
  };
}

const streamDeck = {
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  actions: {
    registerAction: jest.fn()
  },
  connect: jest.fn()
};

export default streamDeck;
