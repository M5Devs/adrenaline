const adrenaline = require('../build/Release/adrenaline.node');

console.log('Creating window...');

const winHandle = adrenaline.createWindow({
  title: 'Adrenaline.js PoC',
  width: 600,
  height: 400,
  html: '<h1>Adrenaline.js is Running! 🚀</h1>'
});

console.log('Window created successfully, Node.js loop still running!');

setTimeout(() => {
  console.log('Closing window automatically after timeout...');
  adrenaline.closeWindow(winHandle);
  console.log('Window closed successfully.');
}, 2000);
