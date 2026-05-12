describe('SmoldotProvider transport classification (issue #58 scope expansion)', () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('classifies ENOTFOUND on chainspec fetch as TRANSPORT_ERROR / dns_failure', async () => {
    await jest.isolateModulesAsync(async () => {
      globalThis.fetch = jest.fn(async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND rpc.vara.network'), {
          code: 'ENOTFOUND',
        });
      }) as any;
      // Import inside the isolated block — each isolateModulesAsync creates a
      // fresh module graph, so the CliError instanceof check has to come from
      // the same instance the SmoldotProvider sees.
      const { CliError } = await import('../utils/errors');
      const { SmoldotProvider } = await import('../services/light-client');
      const provider = new SmoldotProvider();
      let captured: unknown;
      try {
        await provider.connect();
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(CliError);
      const cli = captured as InstanceType<typeof CliError>;
      expect(cli.code).toBe('TRANSPORT_ERROR');
      expect(cli.meta?.reason).toBe('dns_failure');
      expect(cli.meta?.host).toBe('rpc.vara.network');
      expect(cli.meta?.endpoint).toBe('https://rpc.vara.network');
    });
  });

  it('classifies a 200-but-non-JSON response as TRANSPORT_ERROR / protocol_mismatch', async () => {
    await jest.isolateModulesAsync(async () => {
      globalThis.fetch = jest.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON at position 0');
          },
        } as unknown as Response;
      }) as any;
      const { CliError } = await import('../utils/errors');
      const { SmoldotProvider } = await import('../services/light-client');
      const provider = new SmoldotProvider();
      let captured: unknown;
      try {
        await provider.connect();
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(CliError);
      const cli = captured as InstanceType<typeof CliError>;
      expect(cli.code).toBe('TRANSPORT_ERROR');
      expect(cli.meta?.reason).toBe('protocol_mismatch');
      expect(cli.meta?.endpoint).toBe('https://rpc.vara.network');
    });
  });

  it('classifies ECONNREFUSED on chainspec fetch as TRANSPORT_ERROR / connection_refused', async () => {
    await jest.isolateModulesAsync(async () => {
      globalThis.fetch = jest.fn(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
          code: 'ECONNREFUSED',
        });
      }) as any;
      const { CliError } = await import('../utils/errors');
      const { SmoldotProvider } = await import('../services/light-client');
      const provider = new SmoldotProvider();
      let captured: unknown;
      try {
        await provider.connect();
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(CliError);
      const cli = captured as InstanceType<typeof CliError>;
      expect(cli.code).toBe('TRANSPORT_ERROR');
      expect(cli.meta?.reason).toBe('connection_refused');
    });
  });
});
