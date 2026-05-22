import {
  computeMinAmount,
  computeMaxAmount,
  validateSlippage,
  validatePositiveAmount,
  computePriceImpact,
  _enrichDexPairsWithSymbolsForTests,
} from '../commands/dex';

describe('DEX helpers', () => {
  describe('computeMinAmount (floor division)', () => {
    it('applies 1% slippage (100 bps)', () => {
      expect(computeMinAmount(1000n, 100)).toBe(990n);
    });

    it('applies 0% slippage', () => {
      expect(computeMinAmount(1000n, 0)).toBe(1000n);
    });

    it('applies 50% slippage (5000 bps)', () => {
      expect(computeMinAmount(1000n, 5000)).toBe(500n);
    });

    it('truncates on small amounts (floor)', () => {
      // 1 * 9900 / 10000 = 0 (floor)
      expect(computeMinAmount(1n, 100)).toBe(0n);
    });

    it('handles zero amount', () => {
      expect(computeMinAmount(0n, 100)).toBe(0n);
    });

    it('handles large amounts', () => {
      const large = 1000000000000000000n; // 1e18
      const result = computeMinAmount(large, 100);
      expect(result).toBe(990000000000000000n);
    });

    it('applies 0.5% slippage (50 bps)', () => {
      expect(computeMinAmount(10000n, 50)).toBe(9950n);
    });
  });

  describe('computeMaxAmount (ceil division)', () => {
    it('applies 1% slippage (100 bps)', () => {
      expect(computeMaxAmount(1000n, 100)).toBe(1010n);
    });

    it('applies 0% slippage', () => {
      expect(computeMaxAmount(1000n, 0)).toBe(1000n);
    });

    it('applies ceiling on small amounts', () => {
      // 1 * 10100 / 10000 = 1.01 → ceil = 2
      expect(computeMaxAmount(1n, 100)).toBe(2n);
    });

    it('handles zero amount', () => {
      expect(computeMaxAmount(0n, 100)).toBe(0n);
    });
  });

  describe('validateSlippage', () => {
    it('accepts 0 bps', () => {
      expect(() => validateSlippage(0)).not.toThrow();
    });

    it('accepts 100 bps', () => {
      expect(() => validateSlippage(100)).not.toThrow();
    });

    it('accepts 5000 bps', () => {
      expect(() => validateSlippage(5000)).not.toThrow();
    });

    it('rejects negative bps', () => {
      expect(() => validateSlippage(-1)).toThrow('Invalid slippage');
    });

    it('rejects > 5000 bps', () => {
      expect(() => validateSlippage(5001)).toThrow('Invalid slippage');
    });

    it('rejects NaN', () => {
      expect(() => validateSlippage(NaN)).toThrow('Invalid slippage');
    });

    it('rejects Infinity', () => {
      expect(() => validateSlippage(Infinity)).toThrow('Invalid slippage');
    });

    it('rejects fractional bps', () => {
      expect(() => validateSlippage(1.5)).toThrow('Invalid slippage');
    });
  });

  describe('validatePositiveAmount', () => {
    it('accepts positive amount', () => {
      expect(() => validatePositiveAmount(1n, 'test')).not.toThrow();
    });

    it('rejects zero', () => {
      expect(() => validatePositiveAmount(0n, 'test')).toThrow('must be greater than zero');
    });

    it('rejects negative', () => {
      expect(() => validatePositiveAmount(-1n, 'test')).toThrow('must be greater than zero');
    });
  });

  describe('computePriceImpact', () => {
    it('returns 0 for zero reserves', () => {
      expect(computePriceImpact(100n, 100n, 0n, 0n)).toBe('0');
    });

    it('returns 0 for zero input', () => {
      expect(computePriceImpact(0n, 0n, 1000n, 1000n)).toBe('0');
    });

    it('computes near-zero impact for small trade on large pool', () => {
      // Pool: 1M/1M, trade: 100 in, ~99.97 out (with 0.3% fee)
      const impact = computePriceImpact(100n, 99n, 1000000n, 1000000n);
      const impactNum = parseFloat(impact);
      expect(impactNum).toBeGreaterThanOrEqual(0);
      expect(impactNum).toBeLessThan(2); // Very low impact
    });

    it('computes significant impact for large trade on small pool', () => {
      // Pool: 1000/1000, trade: 500 in, ~332 out
      const impact = computePriceImpact(500n, 332n, 1000n, 1000n);
      const impactNum = parseFloat(impact);
      expect(impactNum).toBeGreaterThan(10); // High impact
    });

    it('returns positive number for typical trade', () => {
      // Pool: 10000/10000, trade: 1000 in, ~909 out
      const impact = computePriceImpact(1000n, 909n, 10000n, 10000n);
      const impactNum = parseFloat(impact);
      expect(impactNum).toBeGreaterThan(0);
      expect(impactNum).toBeLessThan(100);
    });
  });

  describe('_enrichDexPairsWithSymbolsForTests', () => {
    it('queries each repeated token symbol once and preserves pair order', async () => {
      const tokenA = '0x' + 'aa'.repeat(32);
      const tokenB = '0x' + 'bb'.repeat(32);
      const tokenBUpper = '0x' + 'BB'.repeat(32);
      const tokenC = '0x' + 'cc'.repeat(32);
      const pairs = [
        { token0: tokenA, token1: tokenB, pairAddress: '0x' + '01'.repeat(32) },
        { token0: tokenBUpper, token1: tokenC, pairAddress: '0x' + '02'.repeat(32) },
        { token0: tokenA, token1: tokenC, pairAddress: '0x' + '03'.repeat(32) },
      ];
      const calls: string[] = [];
      const symbols = new Map([
        [tokenA, 'A'],
        [tokenB, 'B'],
        [tokenC, 'C'],
      ]);

      const enriched = await _enrichDexPairsWithSymbolsForTests(pairs, async (address) => {
        calls.push(address);
        return symbols.get(address) ?? null;
      });

      expect(calls.sort()).toEqual([tokenA, tokenB, tokenC].sort());
      expect(enriched).toEqual([
        { ...pairs[0], token0Symbol: 'A', token1Symbol: 'B' },
        { ...pairs[1], token0Symbol: 'B', token1Symbol: 'C' },
        { ...pairs[2], token0Symbol: 'A', token1Symbol: 'C' },
      ]);
    });
  });
});
