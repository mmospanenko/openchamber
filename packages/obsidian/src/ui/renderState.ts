import type { ServerState } from '../server/types';

export type RenderInstruction =
  | { kind: 'loading' }
  | { kind: 'stopped' }
  | { kind: 'iframe'; url: string }
  | { kind: 'external'; url: string }
  | { kind: 'error'; message: string | null };

interface RenderStateInput {
  state: ServerState;
  serverUrl: string | null;
  externalUrl: string | null;
  errorMessage: string | null;
}

export const renderStateFor = (input: RenderStateInput): RenderInstruction => {
  if (input.externalUrl !== null) {
    return { kind: 'external', url: input.externalUrl };
  }
  if (input.state === 'running' && input.serverUrl !== null) {
    return { kind: 'iframe', url: input.serverUrl };
  }
  if (input.state === 'error') {
    return { kind: 'error', message: input.errorMessage };
  }
  if (input.state === 'stopped') {
    return { kind: 'stopped' };
  }
  return { kind: 'loading' };
};
