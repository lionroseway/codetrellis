// The CLI as the CodeTrellis app runs it: on the app's own binary with
// ELECTRON_RUN_AS_NODE=1 (the launchers beside this file set it). The CLI's
// packages are the app's own, inside app.asar, which Electron reads in Node
// mode too. NODE_PATH puts them first, ahead of any NODE_PATH the shell
// already had, and children the CLI starts inherit it.
'use strict';
const path = require('path');
if (process.resourcesPath) {
  const own = path.join(process.resourcesPath, 'app.asar', 'node_modules');
  const rest = (process.env.NODE_PATH || '').split(path.delimiter).filter((p) => p && p !== own);
  process.env.NODE_PATH = [own, ...rest].join(path.delimiter);
  require('module').Module._initPaths();
}
// Started with `-e` (the AppImage launcher), argv has no script; the CLI
// reads its arguments from argv[2]. That launcher ends with --no-sandbox, so
// the AppImage's AppRun does not add it where Node mode refuses it; it is not
// the CLI's.
if (process.argv[1] !== __filename) {
  process.argv.splice(1, 0, __filename);
  if (process.argv[process.argv.length - 1] === '--no-sandbox') process.argv.pop();
}
require('../src/cli/main.js');
