const adrenaline = require('../index.js');

console.log('Creating window...');

const win = adrenaline.createWindow({
  title: 'Adrenaline.js PoC',
  width: 600,
  height: 400,
  html: '<h1>Adrenaline.js is Running! 🚀</h1>'
});

console.log('Window created successfully, Node.js loop still running!');

setTimeout(() => {
  console.log('Closing window automatically after timeout...');
  win.close();
  console.log('Window closed successfully.');
}, 2000);
