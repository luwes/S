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
        reserved: [
          'on',
          'sample',
          'makeComputationNode',
          'makeDataNode',
          'isListening',
          'node',
          'value',
          'current'
        ]
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
  input: 'src/index.js',
  watch: {
    clearScreen: false
  },
  output: {
    name: 'S',
    file: 'dist/S.mjs',
    format: 'esm'
  },
  plugins: plugins.filter((p) => p === sz)
}, {
  input: 'src/index.js',
  watch: {
    clearScreen: false
  },
  output: {
    name: 'S',
    file: 'dist/S.js',
    format: 'umd'
  },
  plugins
}];
