import { Command } from 'commander';
import { registerTokenCommand } from '../commands/token';
import { setOutputOptions } from '../utils';

function buildProgram(): Command {
  const program = new Command();
  program
    .exitOverride()
    .option('--network <name>')
    .option('--ws <endpoint>');
  registerTokenCommand(program);
  return program;
}

describe('token command', () => {
  let stdoutWrite: jest.SpyInstance;

  beforeEach(() => {
    stdoutWrite = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    setOutputOptions({ json: true });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    setOutputOptions({});
  });

  it('resolves a known alias on the selected network', async () => {
    const program = buildProgram();

    await program.parseAsync(['node', 'test', '--network', 'testnet', 'token', 'resolve', 'usdc']);

    const output = JSON.parse(stdoutWrite.mock.calls[0][0] as string);
    expect(output).toMatchObject({
      input: 'usdc',
      address: '0x9f332e61589e0850dce6d8e6070ea5618de33d9f134a4a35d6d1164dc9002f48',
      isKnown: true,
      network: 'testnet',
      symbol: 'WUSDC',
      category: 'bridged',
    });
  });

  it('lists bridged tokens for one network', async () => {
    const program = buildProgram();

    await program.parseAsync(['node', 'test', '--network', 'mainnet', 'token', 'list']);

    const output = JSON.parse(stdoutWrite.mock.calls[0][0] as string);
    expect(output.network).toBe('mainnet');
    expect(output.tokens).toHaveLength(5);
    expect(output.tokens.map((token: { symbol: string }) => token.symbol)).toContain('WUSDC');
  });

  it('lists bridged tokens for all supported networks', async () => {
    const program = buildProgram();

    await program.parseAsync(['node', 'test', 'token', 'list', '--all']);

    const output = JSON.parse(stdoutWrite.mock.calls[0][0] as string);
    expect(output.network).toBe('all');
    expect(output.tokens).toHaveLength(10);
  });
});
