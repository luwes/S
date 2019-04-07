import size from 'rollup-plugin-size';
import { terser } from 'rollup-plugin-terser';

const plugins = [
	size(),
	terser()
];

export default [{
  input: 'dist/es/S.js',
  output: {
  	name: 'S',
    file: 'dist/S.js',
    format: 'umd'
  },
  plugins
}, {
  input: 'dist/es/withsubclocks.js',
  output: {
  	name: 'S',
    file: 'dist/withsubclocks.js',
    format: 'umd'
  },
  plugins
}]
