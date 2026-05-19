import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

await build({
  entryPoints: ['src/app.ts'],
  outfile: 'dist/app.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: false,
  sourcemap: 'linked',
  legalComments: 'linked',
  // @vara-eth/api, viem, and kzg-wasm stay external so Node's runtime
  // resolution can pick the CJS entry via the `main` field. Bundling them
  // followed the ESM `exports.import` path, which dragged in kzg-wasm's ESM
  // build that uses `import.meta.url` — unsupported in our CJS bundle.
  external: [
    'better-sqlite3',
    'smoldot',
    '@vara-eth/api',
    'viem',
    'kzg-wasm',
    '@noble/ciphers',
    '@noble/curves',
    '@noble/hashes',
    '@scure/bip32',
    '@scure/bip39',
  ],
  define: {
    'process.env.VARA_WALLET_VERSION': JSON.stringify(pkg.version),
  },
  logLevel: 'info',
});
