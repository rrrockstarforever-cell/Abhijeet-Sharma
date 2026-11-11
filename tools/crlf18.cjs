const fs = require('fs');
const p = 'C:/Users/Public/build18.cmd';
fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
console.log('ok');
