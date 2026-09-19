import { describe, expect, it } from 'vitest';

import { renderStateFor } from './renderState';

describe('renderStateFor', () => {
  it('renders an iframe at the server URL when the server is running', () => {
    const instruction = renderStateFor({
      externalUrl: null,
      state: 'running',
      serverUrl: 'http://127.0.0.1:3000',
      errorMessage: null,
    });

    expect(instruction).toEqual({
      kind: 'iframe',
      url: 'http://127.0.0.1:3000',
    });
  });

  it('renders loading while the server starts', () => {
    const instruction = renderStateFor({
      externalUrl: null,
      state: 'starting',
      serverUrl: null,
      errorMessage: null,
    });

    expect(instruction).toEqual({ kind: 'loading' });
  });

  it('renders a stopped instruction, not a loading spinner, when the server is stopped', () => {
    const instruction = renderStateFor({
      externalUrl: null,
      state: 'stopped',
      serverUrl: null,
      errorMessage: null,
    });

    expect(instruction).toEqual({ kind: 'stopped' });
  });

  it('renders loading when the state is running but no URL is known', () => {
    const instruction = renderStateFor({
      externalUrl: null,
      state: 'running',
      serverUrl: null,
      errorMessage: null,
    });

    expect(instruction).toEqual({ kind: 'loading' });
  });

  it('renders the error message when the server failed', () => {
    const instruction = renderStateFor({
      externalUrl: null,
      state: 'error',
      serverUrl: null,
      errorMessage: 'OpenChamber executable not found',
    });

    expect(instruction).toEqual({ kind: 'error', message: 'OpenChamber executable not found' });
  });

  it('renders error without a message when none was reported', () => {
    const instruction = renderStateFor({
      externalUrl: null,
      state: 'error',
      serverUrl: null,
      errorMessage: null,
    });

    expect(instruction).toEqual({ kind: 'error', message: null });
  });

  it('renders external mode as an iframe without consulting the manager state', () => {
    const instruction = renderStateFor({
      externalUrl: 'https://remote.example.com',
      state: 'error',
      serverUrl: null,
      errorMessage: 'should be ignored',
    });

    expect(instruction).toEqual({ kind: 'external', url: 'https://remote.example.com' });
  });

  it('treats a configured external URL as external mode even if a server URL exists', () => {
    const instruction = renderStateFor({
      externalUrl: 'https://remote.example.com',
      state: 'running',
      serverUrl: 'http://127.0.0.1:3000',
      errorMessage: null,
    });

    expect(instruction).toEqual({ kind: 'external', url: 'https://remote.example.com' });
  });
});
