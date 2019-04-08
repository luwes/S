// install S in global namespace
//(eval || null)("this").S = require('../../dist/withsubclocks');

const funcs = require('../..');
const S = Object.assign(funcs.default, funcs);

(eval || null)("this").S = S;
