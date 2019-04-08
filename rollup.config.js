import size from 'rollup-plugin-size';
import babel from 'rollup-plugin-babel';
import { terser } from 'rollup-plugin-terser';

const sz = size();

const plugins = [
  sz,
  babel(),
  terser({
    warnings: true,
    mangle: {
      properties: {
        regex: /^_/
      }
    },
    nameCache: {
      props: {
        cname: 6,
        props: {
          // "$_dirty": "__d",
        }
      }
    }
  })
];

export default [{
  input: 'src/S.js',
  output: {
    name: 'S',
    file: 'dist/S.mjs',
    format: 'esm'
  },
  plugins: plugins.filter((p) => p === sz)
}, {
  input: 'src/S.js',
  output: {
    name: 'S',
    file: 'dist/S.js',
    format: 'umd'
  },
  plugins
}];
