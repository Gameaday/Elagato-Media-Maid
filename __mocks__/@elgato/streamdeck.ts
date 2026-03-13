/**
 * Minimal mock of the @elgato/streamdeck module for Jest tests.
 * Covers SDK 2.0 (SDK 3 standard) – supports key, dial, and touch events.
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
  async onWillDisappear(_ev: any): Promise<void> { /* noop */ }
  async onDidReceiveSettings(_ev: any): Promise<void> { /* noop */ }
  async onDialRotate(_ev: any): Promise<void> { /* noop */ }
  async onDialDown(_ev: any): Promise<void> { /* noop */ }
  async onDialUp(_ev: any): Promise<void> { /* noop */ }
  async onTouchTap(_ev: any): Promise<void> { /* noop */ }
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
    debug: jest.fn(),
    setLevel: jest.fn()
  },
  actions: {
    registerAction: jest.fn()
  },
  connect: jest.fn()
};

export default streamDeck;
