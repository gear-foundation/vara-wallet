import { Command } from 'commander';

const mockMessageSend = jest.fn();

jest.mock('../commands/vara-eth-actions', () => ({
  outputVaraEthMessageReply: jest.fn(),
  outputVaraEthMessageSend: (...args: unknown[]) => mockMessageSend(...args),
}));

import { registerMessageCommand } from '../commands/message';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--chain <name>', 'chain');
  program.option('--account <name>', 'account');
  program.option('--passphrase <pass>', 'passphrase');
  registerMessageCommand(program);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMessageSend.mockResolvedValue(undefined);
});

describe('root --chain vara-eth message routing', () => {
  it('converts default message send values with native VARA units', async () => {
    const mirror = '0xabcdef0000000000000000000000000000000002';

    await makeProgram().parseAsync([
      '--chain', 'vara-eth',
      '--account', 'alice',
      'message', 'send', mirror,
      '--payload', '0xabcd',
      '--value', '1',
    ], { from: 'user' });

    expect(mockMessageSend).toHaveBeenCalledWith(mirror, expect.objectContaining({
      account: 'alice',
      payload: '0xabcd',
      value: '1000000000000',
    }));
  });

  it('passes raw message send values through when requested', async () => {
    const mirror = '0xabcdef0000000000000000000000000000000002';

    await makeProgram().parseAsync([
      '--chain', 'vara-eth',
      'message', 'send', mirror,
      '--payload', '0xabcd',
      '--value', '7',
      '--units', 'raw',
    ], { from: 'user' });

    expect(mockMessageSend).toHaveBeenCalledWith(mirror, expect.objectContaining({
      payload: '0xabcd',
      value: '7',
    }));
  });

  it('routes submit-only completion to the Vara.eth action', async () => {
    const mirror = '0xabcdef0000000000000000000000000000000002';

    await makeProgram().parseAsync([
      '--chain', 'vara-eth',
      'message', 'send', mirror,
      '--payload', '0xabcd',
      '--wait', 'submitted',
    ], { from: 'user' });

    expect(mockMessageSend).toHaveBeenCalledWith(mirror, expect.objectContaining({
      wait: 'submitted',
    }));
  });

  it('still rejects native-only message send options on Vara.eth', async () => {
    const mirror = '0xabcdef0000000000000000000000000000000002';

    await expect(makeProgram().parseAsync([
      '--chain', 'vara-eth',
      'message', 'send', mirror,
      '--payload-ascii', 'hello',
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CHAIN_OPTION',
    });

    expect(mockMessageSend).not.toHaveBeenCalled();
  });
});
