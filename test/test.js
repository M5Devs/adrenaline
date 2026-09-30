const path = require('path');

const adrenaline = require('../build/Release/adrenaline.node');

const result = adrenaline.ping();
console.log(result);

if (result === 'Adrenaline Core v0.1.0 is Alive!') {
  process.exit(0);
} else {
  console.error('Unexpected ping output:', result);
  process.exit(1);
}
